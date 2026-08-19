import type { GroupChatMember, GroupChatRoom, Profile, RoleDefinition } from '../types';
import { similarNameKey } from './groupChatValidation';

export const STORE_OPS_LEADERSHIP_ROOM_KIND = 'store_ops_leadership';
export const STORE_OPS_LEADERSHIP_SIMILAR_NAME_PREFIX = 'storeoperationsleadershipteam';
export const STORE_OPS_LEADERSHIP_LIST_TITLE = 'Operations Leadership';
export const STORE_OPS_LEADERSHIP_LIST_SUBTITLE = 'Sub-Leader+';

export function storeOpsLeadershipRoomName(code: string): string {
  const trimmed = String(code ?? '').trim() || 'STORE';
  return `Store Operations Leadership Team - ${trimmed}`;
}

export function storeOpsLeadershipSimilarNameKey(code: string): string {
  return similarNameKey(storeOpsLeadershipRoomName(code));
}

export function isReservedStoreOpsLeadershipSimilarNameKey(key: string): boolean {
  return String(key || '').startsWith(STORE_OPS_LEADERSHIP_SIMILAR_NAME_PREFIX);
}

export function isStoreOpsLeadershipRoom(
  room?: Pick<GroupChatRoom, 'roomKind'> | { roomKind?: string } | null,
): boolean {
  return String(room?.roomKind || '') === STORE_OPS_LEADERSHIP_ROOM_KIND;
}

function profileStoreIds(profile: {
  stores?: Array<{ id?: string } | string> | null;
  storeIds?: string[] | null;
}): string[] {
  if (Array.isArray(profile.storeIds) && profile.storeIds.length) {
    return profile.storeIds.filter(Boolean);
  }
  return (profile.stores ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.id))
    .filter((id): id is string => Boolean(id));
}

function rankOf(role: string, defs: RoleDefinition[]): number {
  const def = (defs || []).find((d) => d.key === role && d.active !== false);
  return typeof def?.rank === 'number' ? def.rank : 999;
}

function canAccessAllStores(role: string, defs: RoleDefinition[]): boolean {
  const def = (defs || []).find((d) => d.key === role && d.active !== false);
  if (def && typeof def.canAccessAllStores === 'boolean') return def.canAccessAllStores;
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}

function userCanAccessStore(
  role: string,
  storeIds: string[],
  storeId: string,
  defs: RoleDefinition[],
): boolean {
  if (canAccessAllStores(role, defs)) return true;
  return storeIds.includes(storeId);
}

export function isStoreOpsLeadershipEligible(
  profile: Pick<Profile, 'approvalStatus' | 'userId' | 'role'> & {
    stores?: Profile['stores'];
    storeIds?: string[];
  },
  storeId: string,
  defs: RoleDefinition[],
): boolean {
  if (!storeId) return false;
  if (profile.approvalStatus !== 'approved') return false;
  if (!String(profile.userId || '').trim()) return false;
  const threshold = rankOf('subleader', defs);
  if (rankOf(profile.role, defs) > threshold) return false;
  return userCanAccessStore(profile.role, profileStoreIds(profile), storeId, defs);
}

export function expectedLeadershipMembers<
  T extends Pick<Profile, 'id' | 'userId' | 'approvalStatus' | 'role'> & {
    stores?: Profile['stores'];
    storeIds?: string[];
  },
>(profiles: T[], storeId: string, defs: RoleDefinition[]): T[] {
  return (profiles || []).filter((p) => isStoreOpsLeadershipEligible(p, storeId, defs));
}

export type LeadershipMemberLike = {
  id?: string;
  userId?: string;
  profileId?: string;
};

export function diffLeadershipMembers(
  expected: Array<{ userId: string; profileId: string }>,
  actual: LeadershipMemberLike[],
): {
  toAdd: Array<{ userId: string; profileId: string }>;
  toRemove: LeadershipMemberLike[];
  noOp: boolean;
} {
  const expectedByUser = new Map(
    expected
      .filter((m) => m.userId && m.profileId)
      .map((m) => [m.userId, m]),
  );
  const actualByUser = new Map(
    (actual || []).filter((m) => m.userId).map((m) => [m.userId as string, m]),
  );
  const toAdd: Array<{ userId: string; profileId: string }> = [];
  for (const [userId, member] of expectedByUser) {
    if (!actualByUser.has(userId)) toAdd.push(member);
  }
  const toRemove: LeadershipMemberLike[] = [];
  for (const [userId, member] of actualByUser) {
    if (!expectedByUser.has(userId)) toRemove.push(member);
  }
  return { toAdd, toRemove, noOp: toAdd.length === 0 && toRemove.length === 0 };
}

export function partitionGroupMembershipRoomIds(
  memberships: Array<
    Pick<GroupChatMember, 'roomId'> & {
      room?: GroupChatRoom | GroupChatRoom[] | null;
    }
  >,
): { privateIds: string[]; leadershipIds: string[] } {
  const privateIds: string[] = [];
  const leadershipIds: string[] = [];
  const seenPrivate = new Set<string>();
  const seenLeadership = new Set<string>();
  for (const m of memberships || []) {
    const roomId = String(m.roomId || '').trim();
    if (!roomId) continue;
    const room = Array.isArray(m.room) ? m.room[0] : m.room;
    if (isStoreOpsLeadershipRoom(room)) {
      if (seenLeadership.has(roomId)) continue;
      seenLeadership.add(roomId);
      leadershipIds.push(roomId);
    } else {
      if (seenPrivate.has(roomId)) continue;
      seenPrivate.add(roomId);
      privateIds.push(roomId);
    }
  }
  return { privateIds, leadershipIds };
}

export function leadershipRoomForStore(
  rooms: GroupChatRoom[],
  storeId: string,
): GroupChatRoom | undefined {
  if (!storeId) return undefined;
  return (rooms || []).find(
    (r) => isStoreOpsLeadershipRoom(r) && String(r.storeId || '') === storeId,
  );
}

export function privateGroupRooms(rooms: GroupChatRoom[]): GroupChatRoom[] {
  return (rooms || []).filter((r) => !isStoreOpsLeadershipRoom(r));
}

/** True when any role's Sub-Leader-or-above eligibility flipped after a rank change. */
export function roleEligibilityCrossedSubleader(
  beforeDefs: RoleDefinition[],
  afterDefs: RoleDefinition[],
): boolean {
  const beforeThreshold = rankOf('subleader', beforeDefs);
  const afterThreshold = rankOf('subleader', afterDefs);
  const keys = new Set([
    ...beforeDefs.map((d) => d.key),
    ...afterDefs.map((d) => d.key),
  ]);
  for (const key of keys) {
    const wasEligible = rankOf(key, beforeDefs) <= beforeThreshold;
    const nowEligible = rankOf(key, afterDefs) <= afterThreshold;
    if (wasEligible !== nowEligible) return true;
  }
  return false;
}
