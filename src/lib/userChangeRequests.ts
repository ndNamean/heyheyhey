import { id } from '@instantdb/react';
import { db } from '../db';
import { adminsForAccessNotify, managersForStores } from './accessReview';
import { canAssignRole, canViewManagedProfile, profileVisibilityStoreIds } from './inviteScope';
import {
  buildUserChangeFinalizedNotifications,
  buildUserChangeFirstApprovedNotifications,
  buildUserChangeRejectedNotifications,
  buildUserChangeRequestedNotifications,
} from './notifications';
import { profileRoleAssignTx } from './roleResolver';
import { canFinalApproveAccess, canRequestUserChanges } from './roles';
import { nowIso } from './utils';
import type {
  Profile,
  Role,
  RoleDefinition,
  UserChangeRequest,
  UserChangeRequestStatus,
  UserChangeRequestType,
} from '../types';

export const OPEN_USER_CHANGE_STATUSES: UserChangeRequestStatus[] = [
  'pending_first_approval',
  'pending_final_approval',
];

export interface UserChangeApproverResolution {
  needsFirstApproval: boolean;
  firstApproverUserIds: string[];
  finalApproverUserIds: string[];
  initialStatus: UserChangeRequestStatus;
}

function approvedProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.approvalStatus === 'approved');
}

function userIds(profiles: Profile[], excludeUserId?: string): string[] {
  return profiles
    .map((p) => p.userId)
    .filter((uid) => uid && uid !== excludeUserId);
}

export function parseStoreIdsJson(json: string | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function parseUserIdsJson(json: string | undefined): string[] {
  return parseStoreIdsJson(json);
}

/** Actor may request a change for an approved, in-scope subordinate (not self). */
export function canRequestChangeFor(
  actor: Profile,
  target: Profile,
  defs: RoleDefinition[],
): boolean {
  if (!canRequestUserChanges(actor.role, defs)) return false;
  if (actor.userId === target.userId || actor.id === target.id) return false;
  if (target.approvalStatus !== 'approved') return false;
  const actorStoreIds = (actor.stores ?? []).map((s) => s.id);
  return canViewManagedProfile(actor.role, target, actorStoreIds, defs);
}

/**
 * Leader/subleader → manager first (overlapping stores), then owner/admin/AM.
 * Manager → final only (owner/admin/AM), no peer-manager step.
 */
export function resolveApprovers(params: {
  requesterUserId: string;
  requesterRole: Role;
  storeIds: string[];
  profiles: Profile[];
}): UserChangeApproverResolution {
  const { requesterUserId, requesterRole, storeIds, profiles } = params;
  const approved = approvedProfiles(profiles);
  const finals = userIds(adminsForAccessNotify(approved), requesterUserId);

  if (!finals.length) {
    throw new Error('No owner, admin, or area manager found to provide final approval.');
  }

  if (requesterRole === 'leader' || requesterRole === 'subleader') {
    const managers = managersForStores(approved, storeIds).filter(
      (p) => p.userId !== requesterUserId,
    );
    if (!managers.length) {
      throw new Error('No store manager found to provide first approval.');
    }
    return {
      needsFirstApproval: true,
      firstApproverUserIds: userIds(managers),
      finalApproverUserIds: finals,
      initialStatus: 'pending_first_approval',
    };
  }

  if (requesterRole === 'manager') {
    return {
      needsFirstApproval: false,
      firstApproverUserIds: [],
      finalApproverUserIds: finals,
      initialStatus: 'pending_final_approval',
    };
  }

  throw new Error('Only Manager and Leader may submit user change requests.');
}

export function canActorFirstApprove(
  actor: Profile,
  request: UserChangeRequest,
): boolean {
  if (actor.userId === request.requestedByUserId) return false;
  if (request.status !== 'pending_first_approval') return false;
  if (canFinalApproveAccess(actor.role)) return true;
  if (actor.role !== 'manager') return false;
  return parseUserIdsJson(request.firstApproverUserIdsJson).includes(actor.userId);
}

export function canActorFinalApprove(
  actor: Profile,
  request: UserChangeRequest,
): boolean {
  if (actor.userId === request.requestedByUserId) return false;
  if (request.status !== 'pending_final_approval') return false;
  return canFinalApproveAccess(actor.role);
}

export function canActorReject(
  actor: Profile,
  request: UserChangeRequest,
): boolean {
  if (!OPEN_USER_CHANGE_STATUSES.includes(request.status as UserChangeRequestStatus)) {
    return false;
  }
  if (request.status === 'pending_first_approval') {
    return canActorFirstApprove(actor, request);
  }
  return canActorFinalApprove(actor, request);
}

export function canActorCancel(
  actor: Profile,
  request: UserChangeRequest,
): boolean {
  if (actor.userId !== request.requestedByUserId) return false;
  return OPEN_USER_CHANGE_STATUSES.includes(request.status as UserChangeRequestStatus);
}

function assertCanRequest(actor: Profile, defs: RoleDefinition[]): void {
  if (!canRequestUserChanges(actor.role, defs)) {
    throw new Error('You cannot request user changes.');
  }
}

function overlappingStoreIds(actor: Profile, target: Profile): string[] {
  const actorStores = new Set((actor.stores ?? []).map((s) => s.id));
  return profileVisibilityStoreIds(target).filter((id) => actorStores.has(id));
}

async function transactAll(txs: unknown[]) {
  await db.transact(txs as Parameters<typeof db.transact>[0]);
  const { schedulePushDeliveryFromTxs } = await import('./pushDelivery');
  schedulePushDeliveryFromTxs(txs);
}

function softRevokeProfileTx(target: Profile, now: string) {
  return db.tx.profiles[target.id].update({
    approvalStatus: 'rejected',
    updatedAt: now,
  });
}

export async function createRoleChangeRequest(params: {
  actor: Profile;
  target: Profile;
  toRole: Role;
  note: string;
  defs: RoleDefinition[];
  profiles: Profile[];
}): Promise<string> {
  const { actor, target, toRole, note, defs, profiles } = params;
  assertCanRequest(actor, defs);
  if (!canRequestChangeFor(actor, target, defs)) {
    throw new Error('You cannot request changes for this user.');
  }
  if (!canAssignRole(actor.role, toRole, defs)) {
    throw new Error('You cannot assign that role.');
  }
  if (toRole === target.role) {
    throw new Error('Target already has that role.');
  }

  const storeIds = overlappingStoreIds(actor, target);
  const routingStoreIds = storeIds.length ? storeIds : profileVisibilityStoreIds(target);
  const routing = resolveApprovers({
    requesterUserId: actor.userId,
    requesterRole: actor.role,
    storeIds: routingStoreIds,
    profiles,
  });

  const requestId = id();
  const now = nowIso();
  const type: UserChangeRequestType = 'role_change';

  await transactAll([
    db.tx.userChangeRequests[requestId]
      .update({
        type,
        status: routing.initialStatus,
        targetUserId: target.userId,
        targetEmail: target.email,
        fromRole: target.role,
        toRole,
        storeIdsJson: JSON.stringify(routingStoreIds),
        note: note.trim(),
        requestedByUserId: actor.userId,
        firstApproverUserIdsJson: JSON.stringify(routing.firstApproverUserIds),
        firstApproverUserId: '',
        firstApproverAt: '',
        firstApproverNote: '',
        finalApproverUserIdsJson: JSON.stringify(routing.finalApproverUserIds),
        finalApproverUserId: '',
        finalApproverAt: '',
        finalApproverNote: '',
        rejectionReason: '',
        createdAt: now,
        updatedAt: now,
      })
      .link({
        requester: actor.id,
        target: target.id,
      }),
    ...buildUserChangeRequestedNotifications({
      requestId,
      type,
      target,
      toRole,
      actor,
      recipientUserIds:
        routing.initialStatus === 'pending_first_approval'
          ? routing.firstApproverUserIds
          : routing.finalApproverUserIds,
      status: routing.initialStatus,
      note,
    }),
  ]);

  return requestId;
}

export async function createDeleteRequest(params: {
  actor: Profile;
  target: Profile;
  note: string;
  defs: RoleDefinition[];
  profiles: Profile[];
}): Promise<string> {
  const { actor, target, note, defs, profiles } = params;
  assertCanRequest(actor, defs);
  if (!canRequestChangeFor(actor, target, defs)) {
    throw new Error('You cannot request changes for this user.');
  }

  const storeIds = overlappingStoreIds(actor, target);
  const routingStoreIds = storeIds.length ? storeIds : profileVisibilityStoreIds(target);
  const routing = resolveApprovers({
    requesterUserId: actor.userId,
    requesterRole: actor.role,
    storeIds: routingStoreIds,
    profiles,
  });

  const requestId = id();
  const now = nowIso();
  const type: UserChangeRequestType = 'delete';

  await transactAll([
    db.tx.userChangeRequests[requestId]
      .update({
        type,
        status: routing.initialStatus,
        targetUserId: target.userId,
        targetEmail: target.email,
        fromRole: target.role,
        toRole: '',
        storeIdsJson: JSON.stringify(routingStoreIds),
        note: note.trim(),
        requestedByUserId: actor.userId,
        firstApproverUserIdsJson: JSON.stringify(routing.firstApproverUserIds),
        firstApproverUserId: '',
        firstApproverAt: '',
        firstApproverNote: '',
        finalApproverUserIdsJson: JSON.stringify(routing.finalApproverUserIds),
        finalApproverUserId: '',
        finalApproverAt: '',
        finalApproverNote: '',
        rejectionReason: '',
        createdAt: now,
        updatedAt: now,
      })
      .link({
        requester: actor.id,
        target: target.id,
      }),
    ...buildUserChangeRequestedNotifications({
      requestId,
      type,
      target,
      toRole: '',
      actor,
      recipientUserIds:
        routing.initialStatus === 'pending_first_approval'
          ? routing.firstApproverUserIds
          : routing.finalApproverUserIds,
      status: routing.initialStatus,
      note,
    }),
  ]);

  return requestId;
}

export async function firstApproveUserChangeRequest(params: {
  request: UserChangeRequest;
  actor: Profile;
  note?: string;
  profiles?: Profile[];
}): Promise<void> {
  const { request, actor, note } = params;
  if (!canActorFirstApprove(actor, request)) {
    throw new Error('You cannot provide first approval for this request.');
  }

  const now = nowIso();
  const toStatus: UserChangeRequestStatus = 'pending_final_approval';
  const finalIds = parseUserIdsJson(request.finalApproverUserIdsJson);

  await transactAll([
    db.tx.userChangeRequests[request.id].update({
      status: toStatus,
      firstApproverUserId: actor.userId,
      firstApproverAt: now,
      firstApproverNote: note?.trim() || '',
      updatedAt: now,
    }),
    ...buildUserChangeFirstApprovedNotifications({
      request,
      actor,
      recipientUserIds: [request.requestedByUserId, ...finalIds],
      note,
    }),
  ]);
}

function applyApprovedChange(params: {
  request: UserChangeRequest;
  target: Profile;
  defs: RoleDefinition[];
  now: string;
}): unknown[] {
  const { request, target, defs, now } = params;
  if (request.type === 'role_change') {
    if (!request.toRole) throw new Error('Missing target role on request.');
    return profileRoleAssignTx(target.id, request.toRole as Role, defs, target.roleDefinition?.id);
  }
  if (request.type === 'delete') {
    return [softRevokeProfileTx(target, now)];
  }
  throw new Error('Unknown user change request type.');
}

export async function finalApproveUserChangeRequest(params: {
  request: UserChangeRequest;
  actor: Profile;
  target: Profile;
  defs: RoleDefinition[];
  note?: string;
  profiles?: Profile[];
}): Promise<void> {
  const { request, actor, target, defs, note } = params;
  if (!canActorFinalApprove(actor, request)) {
    throw new Error('You cannot provide final approval for this request.');
  }
  if (target.userId !== request.targetUserId) {
    throw new Error('Target profile does not match this request.');
  }

  const now = nowIso();
  const toStatus: UserChangeRequestStatus = 'approved';
  const applyTxs = applyApprovedChange({ request, target, defs, now });

  await transactAll([
    db.tx.userChangeRequests[request.id].update({
      status: toStatus,
      finalApproverUserId: actor.userId,
      finalApproverAt: now,
      finalApproverNote: note?.trim() || '',
      updatedAt: now,
    }),
    ...applyTxs,
    ...buildUserChangeFinalizedNotifications({
      request,
      actor,
      target,
      note,
    }),
  ]);
}

/**
 * Owner/Admin/AM may finalize from pending_first_approval, skipping manager step.
 */
export async function elevatedApproveUserChangeRequest(params: {
  request: UserChangeRequest;
  actor: Profile;
  target: Profile;
  defs: RoleDefinition[];
  note?: string;
}): Promise<void> {
  const { request, actor, target, defs, note } = params;
  if (!canFinalApproveAccess(actor.role)) {
    throw new Error('Only owner, admin, or area manager can fully approve.');
  }
  if (actor.userId === request.requestedByUserId) {
    throw new Error('You cannot approve your own request.');
  }
  if (!OPEN_USER_CHANGE_STATUSES.includes(request.status as UserChangeRequestStatus)) {
    throw new Error('This request is no longer pending.');
  }
  if (target.userId !== request.targetUserId) {
    throw new Error('Target profile does not match this request.');
  }

  const now = nowIso();
  const fromStatus = request.status;
  const patch: Record<string, unknown> = {
    status: 'approved',
    finalApproverUserId: actor.userId,
    finalApproverAt: now,
    finalApproverNote: note?.trim() || '',
    updatedAt: now,
  };
  if (fromStatus === 'pending_first_approval' && !request.firstApproverUserId) {
    patch.firstApproverUserId = actor.userId;
    patch.firstApproverAt = now;
    patch.firstApproverNote = note?.trim() || '';
  }

  const applyTxs = applyApprovedChange({ request, target, defs, now });

  await transactAll([
    db.tx.userChangeRequests[request.id].update(patch),
    ...applyTxs,
    ...buildUserChangeFinalizedNotifications({
      request: { ...request, status: 'approved' },
      actor,
      target,
      note,
    }),
  ]);
}

export async function rejectUserChangeRequest(params: {
  request: UserChangeRequest;
  actor: Profile;
  reason: string;
}): Promise<void> {
  const { request, actor, reason } = params;
  if (!reason.trim()) throw new Error('A rejection reason is required.');
  if (!canActorReject(actor, request) && !(canFinalApproveAccess(actor.role) &&
    OPEN_USER_CHANGE_STATUSES.includes(request.status as UserChangeRequestStatus))) {
    throw new Error('You cannot reject this request.');
  }

  const now = nowIso();
  await transactAll([
    db.tx.userChangeRequests[request.id].update({
      status: 'rejected',
      rejectionReason: reason.trim(),
      updatedAt: now,
    }),
    ...buildUserChangeRejectedNotifications({
      request,
      actor,
      reason,
    }),
  ]);
}

export async function cancelUserChangeRequest(params: {
  request: UserChangeRequest;
  actor: Profile;
  defs: RoleDefinition[];
}): Promise<void> {
  const { request, actor, defs } = params;
  if (!canActorCancel(actor, request)) {
    throw new Error('Only the requester can cancel a pending request.');
  }
  assertCanRequest(actor, defs);
  const now = nowIso();
  await transactAll([
    db.tx.userChangeRequests[request.id].update({
      status: 'cancelled',
      updatedAt: now,
    }),
  ]);
}

export function filterUserChangeRequestsForViewer(
  requests: UserChangeRequest[],
  viewer: Profile,
): UserChangeRequest[] {
  if (canFinalApproveAccess(viewer.role)) return requests;

  return requests.filter((r) => {
    if (r.requestedByUserId === viewer.userId) return true;
    if (parseUserIdsJson(r.firstApproverUserIdsJson).includes(viewer.userId)) return true;
    if (parseUserIdsJson(r.finalApproverUserIdsJson).includes(viewer.userId)) return true;
    if (r.firstApproverUserId === viewer.userId || r.finalApproverUserId === viewer.userId) {
      return true;
    }
    return false;
  });
}
