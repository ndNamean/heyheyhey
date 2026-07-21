import { id } from '@instantdb/react';
import { db } from '../db';
import { managersForStores } from './accessReview';
import {
  canAccessAllStores,
  canFinalApproveTemplateItemProposal,
  canFirstApproveTemplateItemProposal,
  canProposeTemplateItem,
  canPublishTemplateItemProposal,
  normalizeFailureCategory,
  userCanAccessStore,
} from './roles';
import { itemPayload, type TemplateItemDraft } from './templatePersistence';
import {
  parseTemplateSchedule,
  serializeTemplateSchedule,
} from './templateSchedule';
import { nowIso } from './utils';
import type {
  ChecklistItemProposal,
  ChecklistItemProposalEventType,
  ChecklistItemProposalStatus,
  Profile,
  Role,
  RoleDefinition,
  Template,
  TemplateItem,
} from '../types';

export const OPEN_PROPOSAL_STATUSES: ChecklistItemProposalStatus[] = [
  'draft',
  'pending_first_approval',
  'changes_requested',
  'pending_final_approval',
  'approved',
];

export const PENDING_SIMILARITY_STATUSES: ChecklistItemProposalStatus[] = [
  'pending_first_approval',
  'changes_requested',
  'pending_final_approval',
  'approved',
];

export interface ProposalApproverResolution {
  firstApproverUserIds: string[];
  firstApproverRole: string;
  finalApproverUserIds: string[];
  finalApproverRole: string;
}

export interface SimilarMatch {
  kind: 'item' | 'proposal';
  id: string;
  title: string;
  section: string;
  status?: string;
}

export interface ProposalItemFields {
  section: string;
  title: string;
  requirement: string;
  reason: string;
  proofType: string;
  assignedRole: string;
  failureCategory: string;
  required: boolean;
  completionTime: string;
  supportingEvidenceJson?: string;
  sourceReportId?: string;
  duplicateOverrideReason?: string;
}

function approvedProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.approvalStatus === 'approved');
}

function profilesByRoles(profiles: Profile[], roles: Role[]): Profile[] {
  const set = new Set(roles);
  return approvedProfiles(profiles).filter((p) => set.has(p.role));
}

function userIds(profiles: Profile[], excludeUserId?: string): string[] {
  return profiles
    .map((p) => p.userId)
    .filter((uid) => uid && uid !== excludeUserId);
}

/**
 * Resolve first/final approver candidates from org roles + store overlap.
 * No seniorManager role exists — manager proposals route AM → admin/owner.
 */
export function resolveChecklistItemProposalApprovers(params: {
  requesterUserId: string;
  requesterRole: Role;
  requesterStoreId: string;
  profiles: Profile[];
}): ProposalApproverResolution {
  const { requesterUserId, requesterRole, requesterStoreId, profiles } = params;
  const approved = approvedProfiles(profiles);

  if (requesterRole === 'subleader' || requesterRole === 'leader') {
    const managers = managersForStores(approved, [requesterStoreId]).filter(
      (p) => p.userId !== requesterUserId,
    );
    const areaManagers = profilesByRoles(approved, ['areaManager']).filter(
      (p) => p.userId !== requesterUserId,
    );
    if (!managers.length) {
      throw new Error('No store manager found to provide first approval.');
    }
    if (!areaManagers.length) {
      throw new Error('No area manager found to provide final approval.');
    }
    return {
      firstApproverUserIds: userIds(managers),
      firstApproverRole: 'manager',
      finalApproverUserIds: userIds(areaManagers),
      finalApproverRole: 'areaManager',
    };
  }

  if (requesterRole === 'manager') {
    const areaManagers = profilesByRoles(approved, ['areaManager']).filter(
      (p) => p.userId !== requesterUserId,
    );
    const ownersAdmins = profilesByRoles(approved, ['admin', 'owner']).filter(
      (p) => p.userId !== requesterUserId,
    );
    if (!areaManagers.length) {
      throw new Error('No area manager found to provide first approval.');
    }
    if (!ownersAdmins.length) {
      throw new Error('No admin or owner found to provide final approval.');
    }
    return {
      firstApproverUserIds: userIds(areaManagers),
      firstApproverRole: 'areaManager',
      finalApproverUserIds: userIds(ownersAdmins),
      finalApproverRole: 'admin',
    };
  }

  throw new Error('Only Sub-Leader and higher operational roles may submit proposals.');
}

export function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textsSimilar(a: string, b: string): boolean {
  const na = normalizeComparableText(a);
  const nb = normalizeComparableText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter(Boolean));
  const wb = nb.split(' ').filter(Boolean);
  if (!wb.length) return false;
  const overlap = wb.filter((w) => wa.has(w)).length;
  return overlap / wb.length >= 0.7;
}

export function findSimilarChecklistItemsAndProposals(params: {
  title: string;
  requirement: string;
  templateItems: TemplateItem[];
  proposals: ChecklistItemProposal[];
  excludeProposalId?: string;
}): SimilarMatch[] {
  const matches: SimilarMatch[] = [];
  for (const item of params.templateItems) {
    if (
      textsSimilar(params.title, item.title) ||
      textsSimilar(params.requirement, item.requirement)
    ) {
      matches.push({
        kind: 'item',
        id: item.id,
        title: item.title,
        section: item.section,
      });
    }
  }
  for (const p of params.proposals) {
    if (params.excludeProposalId && p.id === params.excludeProposalId) continue;
    if (!PENDING_SIMILARITY_STATUSES.includes(p.status as ChecklistItemProposalStatus)) {
      continue;
    }
    if (textsSimilar(params.title, p.title) || textsSimilar(params.requirement, p.requirement)) {
      matches.push({
        kind: 'proposal',
        id: p.id,
        title: p.title,
        section: p.section,
        status: p.status,
      });
    }
  }
  return matches;
}

export function parseUserIdsJson(json: string | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function parseStoreIdsJson(json: string | undefined): string[] {
  return parseUserIdsJson(json);
}

export function assertCanPropose(
  role: Role,
  defs: RoleDefinition[] | undefined,
): void {
  if (!canProposeTemplateItem(role, defs)) {
    throw new Error('Only Sub-Leader and higher roles may submit proposals');
  }
}

export function validateProposalItemFields(
  fields: ProposalItemFields,
  scheduleEnabled: boolean,
): void {
  if (!fields.section.trim()) throw new Error('Section is required.');
  if (!fields.title.trim()) throw new Error('Item title is required.');
  if (!fields.requirement.trim()) throw new Error('Requirement is required.');
  if (!fields.reason.trim()) throw new Error('Reason is required.');
  if (!fields.proofType.trim()) throw new Error('Proof type is required.');
  if (!fields.assignedRole.trim()) throw new Error('Assigned role is required.');
  if (!fields.failureCategory.trim()) throw new Error('Failure category is required.');
  if (scheduleEnabled && !fields.completionTime.trim()) {
    throw new Error('Completion time is required when the template schedule is enabled.');
  }
}

export function canActorFirstApprove(
  actor: Profile,
  proposal: ChecklistItemProposal,
  defs?: RoleDefinition[],
): boolean {
  if (actor.userId === proposal.requestedByUserId) return false;
  if (proposal.status !== 'pending_first_approval') return false;
  if (!canFirstApproveTemplateItemProposal(actor.role, defs)) return false;
  const assigned = parseUserIdsJson(proposal.firstApproverUserIdsJson);
  return assigned.includes(actor.userId);
}

export function canActorFinalApprove(
  actor: Profile,
  proposal: ChecklistItemProposal,
  defs?: RoleDefinition[],
): boolean {
  if (actor.userId === proposal.requestedByUserId) return false;
  if (proposal.status !== 'pending_final_approval') return false;
  if (!canFinalApproveTemplateItemProposal(actor.role, defs)) return false;
  if (proposal.firstApproverUserId && proposal.firstApproverUserId === actor.userId) {
    return false;
  }
  const assigned = parseUserIdsJson(proposal.finalApproverUserIdsJson);
  return assigned.includes(actor.userId);
}

export function canActorPublish(
  actor: Profile,
  proposal: ChecklistItemProposal,
  defs?: RoleDefinition[],
): boolean {
  if (proposal.status !== 'approved') return false;
  if (proposal.resultingTemplateItemId) return false;
  return canPublishTemplateItemProposal(actor.role, defs);
}

export function canActorEditProposal(
  actor: Profile,
  proposal: ChecklistItemProposal,
  defs?: RoleDefinition[],
): boolean {
  if (actor.userId !== proposal.requestedByUserId) return false;
  if (!canProposeTemplateItem(actor.role, defs)) return false;
  return proposal.status === 'draft' || proposal.status === 'changes_requested';
}

function eventTx(
  proposalId: string,
  eventType: ChecklistItemProposalEventType,
  actorUserId: string,
  fromStatus: string,
  toStatus: string,
  metadata: Record<string, unknown> = {},
) {
  const eventId = id();
  return db.tx.checklistItemProposalEvents[eventId]
    .update({
      proposalId,
      eventType,
      actorUserId,
      fromStatus,
      toStatus,
      metadataJson: JSON.stringify(metadata),
      createdAt: nowIso(),
    })
    .link({ proposal: proposalId });
}

function notificationTx(params: {
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  storeId: string;
  itemTitle: string;
  actorUserId: string;
  actorRole: string;
  actionStatus: string;
  proposalId: string;
}) {
  return db.tx.notifications[id()].update({
    recipientUserId: params.recipientUserId,
    type: params.type,
    reportId: params.proposalId,
    reportResponseId: '',
    storeId: params.storeId,
    title: params.title,
    body: params.body,
    itemTitle: params.itemTitle,
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: params.actionStatus,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    readAt: '',
    createdAt: nowIso(),
  });
}

function notifyUsers(
  userIds: string[],
  builder: (uid: string) => ReturnType<typeof notificationTx>,
) {
  const seen = new Set<string>();
  const txs = [];
  for (const uid of userIds) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    txs.push(builder(uid));
  }
  return txs;
}

async function transactAll(txs: unknown[]) {
  await db.transact(txs as Parameters<typeof db.transact>[0]);
}

export interface CreateProposalParams {
  actor: Profile;
  defs?: RoleDefinition[];
  template: Template;
  sourceStoreId: string;
  fields: ProposalItemFields;
  profiles: Profile[];
  submitNow: boolean;
  existingProposals: ChecklistItemProposal[];
}

export async function createChecklistItemProposal(
  params: CreateProposalParams,
): Promise<string> {
  const { actor, defs, template, sourceStoreId, fields, profiles, submitNow, existingProposals } =
    params;
  assertCanPropose(actor.role, defs);

  const actorStoreIds = (actor.stores ?? []).map((s) => s.id);
  if (!userCanAccessStore(actor.role, actorStoreIds, sourceStoreId, defs)) {
    throw new Error('You cannot propose items for this store.');
  }
  const templateStoreIds = (template.stores ?? []).map((s) => s.id);
  if (templateStoreIds.length && !templateStoreIds.includes(sourceStoreId)) {
    throw new Error('Source store is not assigned to this template.');
  }

  const schedule = parseTemplateSchedule(template.scheduleJson);
  validateProposalItemFields(fields, schedule.enabled);

  const similar = findSimilarChecklistItemsAndProposals({
    title: fields.title,
    requirement: fields.requirement,
    templateItems: (template.items ?? []) as TemplateItem[],
    proposals: existingProposals.filter((p) => p.templateId === template.id),
  });
  if (similar.length && !fields.duplicateOverrideReason?.trim()) {
    throw new Error('A similar checklist item or proposal already exists.');
  }

  const routing = resolveChecklistItemProposalApprovers({
    requesterUserId: actor.userId,
    requesterRole: actor.role,
    requesterStoreId: sourceStoreId,
    profiles,
  });

  const proposalId = id();
  const now = nowIso();
  const status: ChecklistItemProposalStatus = submitNow ? 'pending_first_approval' : 'draft';
  const failureCategory = normalizeFailureCategory(fields.failureCategory);
  const proposedItem = {
    section: fields.section.trim(),
    title: fields.title.trim(),
    requirement: fields.requirement.trim(),
    proofType: fields.proofType,
    required: fields.required,
    assignedRole: fields.assignedRole,
    failureCategory,
    completionTime: fields.completionTime.trim(),
  };

  const txs: unknown[] = [
    db.tx.checklistItemProposals[proposalId]
      .update({
        templateId: template.id,
        templateNameSnapshot: template.name,
        templateVersionSnapshot: template.updatedAt || template.createdAt || '',
        sourceStoreId,
        affectedStoreIdsJson: JSON.stringify(templateStoreIds),
        requestedByUserId: actor.userId,
        requesterNameSnapshot: actor.displayName || actor.email,
        requesterRoleSnapshot: actor.role,
        requesterStoreId: sourceStoreId,
        section: proposedItem.section,
        title: proposedItem.title,
        requirement: proposedItem.requirement,
        reason: fields.reason.trim(),
        proofType: proposedItem.proofType,
        assignedRole: proposedItem.assignedRole,
        failureCategory: proposedItem.failureCategory,
        required: proposedItem.required,
        completionTime: proposedItem.completionTime,
        sourceReportId: fields.sourceReportId?.trim() || '',
        supportingEvidenceJson: fields.supportingEvidenceJson?.trim() || '',
        proposedItemJson: JSON.stringify(proposedItem),
        status,
        firstApproverUserIdsJson: JSON.stringify(routing.firstApproverUserIds),
        firstApproverRole: routing.firstApproverRole,
        firstApproverUserId: '',
        firstApprovedAt: '',
        firstApprovalComment: '',
        finalApproverUserIdsJson: JSON.stringify(routing.finalApproverUserIds),
        finalApproverRole: routing.finalApproverRole,
        finalApproverUserId: '',
        finalApprovedAt: '',
        finalApprovalComment: '',
        rejectedByUserId: '',
        rejectedAt: '',
        rejectionReason: '',
        publishedAt: '',
        publishedByUserId: '',
        resultingTemplateItemId: '',
        similarityWarningJson: JSON.stringify(similar),
        duplicateOverrideReason: fields.duplicateOverrideReason?.trim() || '',
        createdAt: now,
        updatedAt: now,
      })
      .link({
        template: template.id,
        requester: actor.id,
        sourceStore: sourceStoreId,
        ...(fields.sourceReportId?.trim()
          ? { sourceReport: fields.sourceReportId.trim() }
          : {}),
      }),
    eventTx(
      proposalId,
      submitNow ? 'proposal_submitted' : 'proposal_created',
      actor.userId,
      '',
      status,
      { similarCount: similar.length },
    ),
  ];

  if (submitNow) {
    txs.push(
      ...notifyUsers(routing.firstApproverUserIds, (uid) =>
        notificationTx({
          recipientUserId: uid,
          type: 'checklist_item_proposal_first_approval_required',
          title: 'Checklist item proposal needs first approval',
          body: `${actor.displayName || actor.email} proposed "${proposedItem.title}" for ${template.name}.`,
          storeId: sourceStoreId,
          itemTitle: proposedItem.title,
          actorUserId: actor.userId,
          actorRole: actor.role,
          actionStatus: status,
          proposalId,
        }),
      ),
      ...notifyUsers(routing.firstApproverUserIds, (uid) =>
        notificationTx({
          recipientUserId: uid,
          type: 'checklist_item_proposal_submitted',
          title: 'New checklist item proposal',
          body: `"${proposedItem.title}" was submitted for ${template.name}.`,
          storeId: sourceStoreId,
          itemTitle: proposedItem.title,
          actorUserId: actor.userId,
          actorRole: actor.role,
          actionStatus: status,
          proposalId,
        }),
      ),
    );
  }

  await transactAll(txs);
  return proposalId;
}

export async function submitChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
  template: Template;
  profiles: Profile[];
  existingProposals: ChecklistItemProposal[];
  fields?: ProposalItemFields;
}): Promise<void> {
  const { proposal, actor, defs, template, profiles, existingProposals, fields } = params;
  if (!canActorEditProposal(actor, proposal, defs) && proposal.status !== 'draft') {
    if (proposal.status !== 'changes_requested' || actor.userId !== proposal.requestedByUserId) {
      throw new Error('You cannot submit this proposal.');
    }
  }
  assertCanPropose(actor.role, defs);

  const nextFields: ProposalItemFields = fields ?? {
    section: proposal.section,
    title: proposal.title,
    requirement: proposal.requirement,
    reason: proposal.reason,
    proofType: proposal.proofType,
    assignedRole: proposal.assignedRole,
    failureCategory: proposal.failureCategory,
    required: proposal.required,
    completionTime: proposal.completionTime,
    supportingEvidenceJson: proposal.supportingEvidenceJson,
    sourceReportId: proposal.sourceReportId,
    duplicateOverrideReason: proposal.duplicateOverrideReason,
  };

  const schedule = parseTemplateSchedule(template.scheduleJson);
  validateProposalItemFields(nextFields, schedule.enabled);

  const similar = findSimilarChecklistItemsAndProposals({
    title: nextFields.title,
    requirement: nextFields.requirement,
    templateItems: (template.items ?? []) as TemplateItem[],
    proposals: existingProposals.filter((p) => p.templateId === template.id),
    excludeProposalId: proposal.id,
  });
  if (similar.length && !nextFields.duplicateOverrideReason?.trim()) {
    throw new Error('A similar checklist item or proposal already exists.');
  }

  const routing = resolveChecklistItemProposalApprovers({
    requesterUserId: actor.userId,
    requesterRole: actor.role,
    requesterStoreId: proposal.requesterStoreId || proposal.sourceStoreId,
    profiles,
  });

  const fromStatus = proposal.status;
  const toStatus: ChecklistItemProposalStatus = 'pending_first_approval';
  const now = nowIso();
  const wasChanges = fromStatus === 'changes_requested';

  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      section: nextFields.section.trim(),
      title: nextFields.title.trim(),
      requirement: nextFields.requirement.trim(),
      reason: nextFields.reason.trim(),
      proofType: nextFields.proofType,
      assignedRole: nextFields.assignedRole,
      failureCategory: normalizeFailureCategory(nextFields.failureCategory),
      required: nextFields.required,
      completionTime: nextFields.completionTime.trim(),
      supportingEvidenceJson: nextFields.supportingEvidenceJson?.trim() || '',
      proposedItemJson: JSON.stringify({
        section: nextFields.section.trim(),
        title: nextFields.title.trim(),
        requirement: nextFields.requirement.trim(),
        proofType: nextFields.proofType,
        required: nextFields.required,
        assignedRole: nextFields.assignedRole,
        failureCategory: normalizeFailureCategory(nextFields.failureCategory),
        completionTime: nextFields.completionTime.trim(),
      }),
      status: toStatus,
      firstApproverUserIdsJson: JSON.stringify(routing.firstApproverUserIds),
      firstApproverRole: routing.firstApproverRole,
      firstApproverUserId: '',
      firstApprovedAt: '',
      firstApprovalComment: '',
      finalApproverUserIdsJson: JSON.stringify(routing.finalApproverUserIds),
      finalApproverRole: routing.finalApproverRole,
      finalApproverUserId: '',
      finalApprovedAt: '',
      finalApprovalComment: '',
      similarityWarningJson: JSON.stringify(similar),
      duplicateOverrideReason: nextFields.duplicateOverrideReason?.trim() || '',
      updatedAt: now,
    }),
    eventTx(
      proposal.id,
      wasChanges ? 'proposal_resubmitted' : 'proposal_submitted',
      actor.userId,
      fromStatus,
      toStatus,
    ),
    ...notifyUsers(routing.firstApproverUserIds, (uid) =>
      notificationTx({
        recipientUserId: uid,
        type: 'checklist_item_proposal_first_approval_required',
        title: 'Checklist item proposal needs first approval',
        body: `"${nextFields.title.trim()}" for ${template.name} is awaiting first approval.`,
        storeId: proposal.sourceStoreId,
        itemTitle: nextFields.title.trim(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        actionStatus: toStatus,
        proposalId: proposal.id,
      }),
    ),
  ]);
}

export async function firstApproveChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
  comment?: string;
}): Promise<void> {
  const { proposal, actor, defs, comment } = params;
  if (!canActorFirstApprove(actor, proposal, defs)) {
    throw new Error('You cannot provide first approval for this proposal.');
  }
  const now = nowIso();
  const toStatus: ChecklistItemProposalStatus = 'pending_final_approval';
  const finalIds = parseUserIdsJson(proposal.finalApproverUserIdsJson);

  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      status: toStatus,
      firstApproverUserId: actor.userId,
      firstApproverRole: actor.role,
      firstApprovedAt: now,
      firstApprovalComment: comment?.trim() || '',
      updatedAt: now,
    }),
    eventTx(proposal.id, 'first_approval_granted', actor.userId, proposal.status, toStatus),
    ...notifyUsers([proposal.requestedByUserId, ...finalIds], (uid) =>
      notificationTx({
        recipientUserId: uid,
        type:
          uid === proposal.requestedByUserId
            ? 'checklist_item_proposal_first_approved'
            : 'checklist_item_proposal_final_approval_required',
        title:
          uid === proposal.requestedByUserId
            ? 'Proposal passed first approval'
            : 'Checklist item proposal needs final approval',
        body: `"${proposal.title}" is now pending final approval.`,
        storeId: proposal.sourceStoreId,
        itemTitle: proposal.title,
        actorUserId: actor.userId,
        actorRole: actor.role,
        actionStatus: toStatus,
        proposalId: proposal.id,
      }),
    ),
  ]);
}

export async function finalApproveChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
  comment?: string;
}): Promise<void> {
  const { proposal, actor, defs, comment } = params;
  if (!canActorFinalApprove(actor, proposal, defs)) {
    throw new Error('You cannot provide final approval for this proposal.');
  }
  const now = nowIso();
  const toStatus: ChecklistItemProposalStatus = 'approved';

  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      status: toStatus,
      finalApproverUserId: actor.userId,
      finalApproverRole: actor.role,
      finalApprovedAt: now,
      finalApprovalComment: comment?.trim() || '',
      updatedAt: now,
    }),
    eventTx(proposal.id, 'final_approval_granted', actor.userId, proposal.status, toStatus),
    ...notifyUsers([proposal.requestedByUserId], (uid) =>
      notificationTx({
        recipientUserId: uid,
        type: 'checklist_item_proposal_approved',
        title: 'Proposal approved',
        body: `"${proposal.title}" was approved and is ready to publish.`,
        storeId: proposal.sourceStoreId,
        itemTitle: proposal.title,
        actorUserId: actor.userId,
        actorRole: actor.role,
        actionStatus: toStatus,
        proposalId: proposal.id,
      }),
    ),
  ]);
}

export async function requestChangesChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
  comment: string;
  level: 'first' | 'final';
}): Promise<void> {
  const { proposal, actor, defs, comment, level } = params;
  if (!comment.trim()) throw new Error('A comment is required when requesting changes.');
  const allowed =
    level === 'first'
      ? canActorFirstApprove(actor, proposal, defs)
      : canActorFinalApprove(actor, proposal, defs);
  if (!allowed) throw new Error('You cannot request changes on this proposal.');

  const now = nowIso();
  const toStatus: ChecklistItemProposalStatus = 'changes_requested';
  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      status: toStatus,
      updatedAt: now,
    }),
    db.tx.checklistItemProposalComments[id()]
      .update({
        proposalId: proposal.id,
        userId: actor.userId,
        userNameSnapshot: actor.displayName || actor.email,
        userRoleSnapshot: actor.role,
        message: comment.trim(),
        createdAt: now,
      })
      .link({ proposal: proposal.id }),
    eventTx(proposal.id, 'changes_requested', actor.userId, proposal.status, toStatus, {
      level,
    }),
    ...notifyUsers([proposal.requestedByUserId], (uid) =>
      notificationTx({
        recipientUserId: uid,
        type: 'checklist_item_proposal_changes_requested',
        title: 'Changes requested on proposal',
        body: comment.trim(),
        storeId: proposal.sourceStoreId,
        itemTitle: proposal.title,
        actorUserId: actor.userId,
        actorRole: actor.role,
        actionStatus: toStatus,
        proposalId: proposal.id,
      }),
    ),
  ]);
}

export async function rejectChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
  reason: string;
  level: 'first' | 'final';
}): Promise<void> {
  const { proposal, actor, defs, reason, level } = params;
  if (!reason.trim()) throw new Error('A rejection reason is required.');
  const allowed =
    level === 'first'
      ? canActorFirstApprove(actor, proposal, defs)
      : canActorFinalApprove(actor, proposal, defs);
  if (!allowed) throw new Error('You cannot reject this proposal.');

  const now = nowIso();
  const toStatus: ChecklistItemProposalStatus = 'rejected';
  const previousReviewer =
    level === 'final' && proposal.firstApproverUserId ? [proposal.firstApproverUserId] : [];

  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      status: toStatus,
      rejectedByUserId: actor.userId,
      rejectedAt: now,
      rejectionReason: reason.trim(),
      updatedAt: now,
    }),
    eventTx(proposal.id, 'proposal_rejected', actor.userId, proposal.status, toStatus, {
      level,
    }),
    ...notifyUsers([proposal.requestedByUserId, ...previousReviewer], (uid) =>
      notificationTx({
        recipientUserId: uid,
        type: 'checklist_item_proposal_rejected',
        title: 'Proposal rejected',
        body: reason.trim(),
        storeId: proposal.sourceStoreId,
        itemTitle: proposal.title,
        actorUserId: actor.userId,
        actorRole: actor.role,
        actionStatus: toStatus,
        proposalId: proposal.id,
      }),
    ),
  ]);
}

export async function cancelChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  defs?: RoleDefinition[];
}): Promise<void> {
  const { proposal, actor, defs } = params;
  if (actor.userId !== proposal.requestedByUserId) {
    throw new Error('Only the requester can cancel this proposal.');
  }
  assertCanPropose(actor.role, defs);
  if (!['draft', 'pending_first_approval', 'changes_requested'].includes(proposal.status)) {
    throw new Error('This proposal can no longer be cancelled.');
  }
  const now = nowIso();
  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      status: 'cancelled',
      updatedAt: now,
    }),
    eventTx(proposal.id, 'proposal_cancelled', actor.userId, proposal.status, 'cancelled'),
  ]);
}

export async function assignChecklistItemProposalApprovers(params: {
  proposal: ChecklistItemProposal;
  actor: Profile;
  firstApproverUserIds: string[];
  finalApproverUserIds: string[];
  firstApproverRole: string;
  finalApproverRole: string;
}): Promise<void> {
  const { proposal, actor } = params;
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new Error('Only Admin or Owner can assign approvers.');
  }
  if (!params.firstApproverUserIds.length || !params.finalApproverUserIds.length) {
    throw new Error('Both first and final approvers are required.');
  }
  const now = nowIso();
  await transactAll([
    db.tx.checklistItemProposals[proposal.id].update({
      firstApproverUserIdsJson: JSON.stringify(params.firstApproverUserIds),
      finalApproverUserIdsJson: JSON.stringify(params.finalApproverUserIds),
      firstApproverRole: params.firstApproverRole,
      finalApproverRole: params.finalApproverRole,
      updatedAt: now,
    }),
    eventTx(proposal.id, 'approvers_assigned', actor.userId, proposal.status, proposal.status, {
      firstApproverUserIds: params.firstApproverUserIds,
      finalApproverUserIds: params.finalApproverUserIds,
    }),
  ]);
}

/**
 * Publish an approved proposal into templateItems. Idempotent.
 * Does not call updateTemplate() — inserts only the new item (+ optional due time).
 */
export async function publishApprovedChecklistItemProposal(params: {
  proposal: ChecklistItemProposal;
  publisher: Profile;
  defs?: RoleDefinition[];
  template: Template;
  existingProposals: ChecklistItemProposal[];
}): Promise<string> {
  const { proposal, publisher, defs, template, existingProposals } = params;

  if (proposal.status === 'published' && proposal.resultingTemplateItemId) {
    return proposal.resultingTemplateItemId;
  }
  if (!canActorPublish(publisher, proposal, defs)) {
    throw new Error('Only an authorized publisher can publish an approved proposal.');
  }
  if (proposal.status === 'rejected' || proposal.status === 'cancelled') {
    throw new Error('This proposal cannot be published.');
  }
  if (proposal.status !== 'approved') {
    throw new Error('Proposal must be approved before publication.');
  }

  const items = (template.items ?? []) as TemplateItem[];
  const similar = findSimilarChecklistItemsAndProposals({
    title: proposal.title,
    requirement: proposal.requirement,
    templateItems: items,
    proposals: existingProposals.filter((p) => p.templateId === template.id),
    excludeProposalId: proposal.id,
  });
  const itemSimilar = similar.filter((m) => m.kind === 'item');
  if (itemSimilar.length && !proposal.duplicateOverrideReason?.trim()) {
    throw new Error('A similar checklist item already exists on the template.');
  }

  const schedule = parseTemplateSchedule(template.scheduleJson);
  if (schedule.enabled && !proposal.completionTime.trim()) {
    throw new Error('Completion time is required when the template schedule is enabled.');
  }

  const newItemId = id();
  const sortOrder =
    items.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1) + 1;
  const draft: TemplateItemDraft = {
    id: newItemId,
    section: proposal.section,
    title: proposal.title,
    requirement: proposal.requirement,
    proofType: proposal.proofType,
    required: proposal.required,
    assignedRole: proposal.assignedRole,
    approverRoles: ['leader', 'subleader', 'manager'],
    weight: 1,
    failureCategory: normalizeFailureCategory(proposal.failureCategory),
  };

  const now = nowIso();
  const txs: unknown[] = [
    db.tx.templateItems[newItemId]
      .update(itemPayload(draft, sortOrder))
      .link({ template: template.id }),
    db.tx.checklistItemProposals[proposal.id].update({
      status: 'published',
      publishedAt: now,
      publishedByUserId: publisher.userId,
      resultingTemplateItemId: newItemId,
      updatedAt: now,
    }),
    eventTx(proposal.id, 'proposal_published', publisher.userId, proposal.status, 'published', {
      resultingTemplateItemId: newItemId,
    }),
  ];

  if (schedule.enabled && proposal.completionTime.trim()) {
    const next = {
      ...schedule,
      itemDueTimes: {
        ...(schedule.itemDueTimes ?? {}),
        [newItemId]: proposal.completionTime.trim(),
      },
    };
    txs.push(
      db.tx.templates[template.id].update({
        scheduleJson: serializeTemplateSchedule(next),
        updatedAt: now,
      }),
    );
  }

  const notifyIds = [
    proposal.requestedByUserId,
    proposal.firstApproverUserId,
    proposal.finalApproverUserId,
  ].filter(Boolean);

  txs.push(
    ...notifyUsers(notifyIds, (uid) =>
      notificationTx({
        recipientUserId: uid,
        type: 'checklist_item_proposal_published',
        title: 'Checklist item published',
        body: `"${proposal.title}" was added to ${proposal.templateNameSnapshot}.`,
        storeId: proposal.sourceStoreId,
        itemTitle: proposal.title,
        actorUserId: publisher.userId,
        actorRole: publisher.role,
        actionStatus: 'published',
        proposalId: proposal.id,
      }),
    ),
  );

  await transactAll(txs);
  return newItemId;
}

export interface ProposalMetrics {
  total: number;
  pendingFirstApproval: number;
  pendingFinalApproval: number;
  changesRequested: number;
  fullyApproved: number;
  published: number;
  rejected: number;
  approvalRate: number | null;
  publicationRate: number | null;
}

export function computeChecklistItemProposalMetrics(
  proposals: ChecklistItemProposal[],
): ProposalMetrics {
  const total = proposals.length;
  const pendingFirstApproval = proposals.filter((p) => p.status === 'pending_first_approval').length;
  const pendingFinalApproval = proposals.filter((p) => p.status === 'pending_final_approval').length;
  const changesRequested = proposals.filter((p) => p.status === 'changes_requested').length;
  const published = proposals.filter((p) => p.status === 'published').length;
  const rejected = proposals.filter((p) => p.status === 'rejected').length;
  const fullyApproved = proposals.filter(
    (p) => p.status === 'approved' || p.status === 'published',
  ).length;
  const reviewed = fullyApproved + rejected;
  const approvalRate = reviewed > 0 ? Math.round((fullyApproved / reviewed) * 1000) / 10 : null;
  const publicationRate =
    fullyApproved > 0 ? Math.round((published / fullyApproved) * 1000) / 10 : null;

  return {
    total,
    pendingFirstApproval,
    pendingFinalApproval,
    changesRequested,
    fullyApproved,
    published,
    rejected,
    approvalRate,
    publicationRate,
  };
}

export function filterProposalsForViewer(
  proposals: ChecklistItemProposal[],
  viewer: Profile,
  defs?: RoleDefinition[],
): ChecklistItemProposal[] {
  if (viewer.role === 'owner' || viewer.role === 'admin') return proposals;
  if (canAccessAllStores(viewer.role, defs)) return proposals;

  const storeIds = new Set((viewer.stores ?? []).map((s) => s.id));

  return proposals.filter((p) => {
    if (p.requestedByUserId === viewer.userId) return true;
    if (parseUserIdsJson(p.firstApproverUserIdsJson).includes(viewer.userId)) return true;
    if (parseUserIdsJson(p.finalApproverUserIdsJson).includes(viewer.userId)) return true;
    if (p.firstApproverUserId === viewer.userId || p.finalApproverUserId === viewer.userId) {
      return true;
    }
    if (storeIds.has(p.sourceStoreId) || storeIds.has(p.requesterStoreId)) return true;
    const affected = parseStoreIdsJson(p.affectedStoreIdsJson);
    return affected.some((sid) => storeIds.has(sid));
  });
}
