/**
 * Server twin of src/lib/storeOpsLeadership.ts — keep eligibility/name/kind in sync.
 */

import { rankOfRole, roleCanAccessAllStores } from '../export/invite-scope.js';
import { similarNameKey } from './validation.js';

export const STORE_OPS_LEADERSHIP_ROOM_KIND = 'store_ops_leadership';
export const STORE_OPS_LEADERSHIP_SIMILAR_NAME_PREFIX = 'storeoperationsleadershipteam';

export function unwrapLinked(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

export function storeOpsLeadershipRoomName(code) {
  const trimmed = String(code ?? '').trim() || 'STORE';
  return `Store Operations Leadership Team - ${trimmed}`;
}

export function storeOpsLeadershipSimilarNameKey(code) {
  return similarNameKey(storeOpsLeadershipRoomName(code));
}

export function isReservedStoreOpsLeadershipSimilarNameKey(key) {
  return String(key || '').startsWith(STORE_OPS_LEADERSHIP_SIMILAR_NAME_PREFIX);
}

export function isStoreOpsLeadershipRoom(room) {
  return String(room?.roomKind || '') === STORE_OPS_LEADERSHIP_ROOM_KIND;
}

function profileStoreIds(profile) {
  if (Array.isArray(profile?.storeIds) && profile.storeIds.length) {
    return profile.storeIds.filter(Boolean);
  }
  return (profile?.stores ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.id))
    .filter(Boolean);
}

function profileCanAccessAllStores(profile, defs) {
  return roleCanAccessAllStores(profile?.role, profile?.roleDefinition, defs);
}

export function userCanAccessStore(profile, storeId, defs) {
  if (!storeId) return false;
  if (profileCanAccessAllStores(profile, defs)) return true;
  return profileStoreIds(profile).includes(storeId);
}

export function isStoreOpsLeadershipEligible(profile, storeId, defs) {
  if (!storeId) return false;
  if (profile?.approvalStatus !== 'approved') return false;
  if (!String(profile?.userId || '').trim()) return false;
  const threshold = rankOfRole('subleader', defs);
  if (rankOfRole(profile.role, defs) > threshold) return false;
  return userCanAccessStore(profile, storeId, defs);
}

/** Store-linked (not all-stores shortcut) — used for nearest-tier local buckets. */
export function isStoreLinkedLeadershipEligible(profile, storeId, defs) {
  if (!storeId) return false;
  if (profile?.approvalStatus !== 'approved') return false;
  if (!String(profile?.userId || '').trim()) return false;
  const threshold = rankOfRole('subleader', defs);
  if (rankOfRole(profile.role, defs) > threshold) return false;
  return profileStoreIds(profile).includes(storeId);
}

export function expectedLeadershipMembers(profiles, storeId, defs) {
  return (profiles || []).filter((p) => isStoreOpsLeadershipEligible(p, storeId, defs));
}

export function diffLeadershipMembers(expected, actual) {
  const expectedByUser = new Map(
    (expected || [])
      .filter((m) => m.userId && m.profileId)
      .map((m) => [m.userId, m]),
  );
  const actualByUser = new Map(
    (actual || []).filter((m) => m.userId).map((m) => [m.userId, m]),
  );
  const toAdd = [];
  for (const [userId, member] of expectedByUser) {
    if (!actualByUser.has(userId)) toAdd.push(member);
  }
  const toRemove = [];
  for (const [userId, member] of actualByUser) {
    if (!expectedByUser.has(userId)) toRemove.push(member);
  }
  return { toAdd, toRemove, noOp: toAdd.length === 0 && toRemove.length === 0 };
}

export function leadershipEscalationDeliveryKey(
  entryId,
  eventType,
  stage,
  recipientUserId,
) {
  return `leadership:logbook:${entryId}:${eventType}:${stage}:${recipientUserId}`;
}

/**
 * First non-empty local rank bucket (subleader, else leader, else manager),
 * minus existing operational recipients. If empty, eligible canAccessAllStores
 * people still not in existingRecipients.
 */
export function nearestLeadershipEscalationRecipients({
  storeId,
  profiles,
  defs,
  existingRecipients,
}) {
  const existing = new Set((existingRecipients || []).filter(Boolean));
  const subRank = rankOfRole('subleader', defs);
  const leaderRank = rankOfRole('leader', defs);
  const managerRank = rankOfRole('manager', defs);
  const buckets = {
    subleader: [],
    leader: [],
    manager: [],
  };
  const allStoreEligible = [];

  for (const profile of profiles || []) {
    const userId = String(profile?.userId || '').trim();
    if (!userId) continue;
    if (isStoreLinkedLeadershipEligible(profile, storeId, defs)) {
      const rank = rankOfRole(profile.role, defs);
      if (rank === subRank) buckets.subleader.push(userId);
      else if (rank === leaderRank) buckets.leader.push(userId);
      else if (rank === managerRank) buckets.manager.push(userId);
    }
    if (
      isStoreOpsLeadershipEligible(profile, storeId, defs) &&
      profileCanAccessAllStores(profile, defs)
    ) {
      allStoreEligible.push(userId);
    }
  }

  const firstBucket = buckets.subleader.length
    ? buckets.subleader
    : buckets.leader.length
      ? buckets.leader
      : buckets.manager.length
        ? buckets.manager
        : [];
  const fromBucket = firstBucket.filter((id) => !existing.has(id));
  if (fromBucket.length) return [...new Set(fromBucket)];
  return [...new Set(allStoreEligible.filter((id) => !existing.has(id)))];
}

export const LEADERSHIP_LIFECYCLE_ACTIONS = [
  'groupChatInvite',
  'groupChatAccept',
  'groupChatDecline',
  'groupChatCancel',
  'groupChatRemind',
  'groupChatRename',
  'groupChatRemoveMember',
  'groupChatLeave',
  'groupChatArchive',
];

export function leadershipLifecycleForbidden(room) {
  return isStoreOpsLeadershipRoom(room);
}
