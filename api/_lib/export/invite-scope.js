/**
 * Invite/assign scope helpers for the invites API.
 * Mirrors src/lib/inviteScope.ts (keep behavior in sync).
 */

const OWNER_ROLE = 'owner';
const ELEVATED_ROLES = new Set(['owner', 'admin', 'areaManager']);
const OWNER_ONLY_INVITE_ROLES = new Set(['owner', 'areaManager']);

function unwrap(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function activeDefs(allDefs) {
  return (allDefs ?? []).filter((d) => d && d.active !== false);
}

export function rankOfRole(role, allDefs) {
  const def = activeDefs(allDefs).find((d) => d.key === role);
  if (def && typeof def.rank === 'number') return def.rank;
  return 999;
}

export function roleCanAccessAllStores(role, roleDefinition, allDefs) {
  const def = unwrap(roleDefinition) ?? activeDefs(allDefs).find((d) => d.key === role);
  if (def && typeof def.canAccessAllStores === 'boolean') {
    return def.canAccessAllStores;
  }
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}

/** Actor may invite targetRole if subordinate (higher rank number). Owner may invite any. */
export function canInviteAsRole(actorRole, targetRole, allDefs) {
  if (!targetRole) return false;
  if (OWNER_ONLY_INVITE_ROLES.has(targetRole) && actorRole !== OWNER_ROLE) {
    return false;
  }
  if (actorRole === OWNER_ROLE) return true;
  if (ELEVATED_ROLES.has(targetRole)) return false;
  return rankOfRole(targetRole, allDefs) > rankOfRole(actorRole, allDefs);
}

export function assertInviteStoreIds(actorRole, actorStoreIds, storeIds, roleDefinition, allDefs) {
  if (roleCanAccessAllStores(actorRole, roleDefinition, allDefs)) return null;
  const allowed = new Set(actorStoreIds ?? []);
  const illegal = (storeIds ?? []).filter((id) => !allowed.has(id));
  if (!illegal.length) return null;
  return 'Forbidden: store selection outside your assigned stores';
}
