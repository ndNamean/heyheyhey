import { orderedRoles, rankOf, capability } from './roleResolver';
import { ELEVATED_ASSIGN_ROLE_KEYS, OWNER_ROLE_KEY, type Role, type RoleDefinition, type Store } from '../types';

const ELEVATED_SET = new Set<string>(ELEVATED_ASSIGN_ROLE_KEYS);

/** True when actor may assign/invite targetRole (strictly lower in hierarchy). Owner may assign any role. */
export function canAssignRole(
  actorRole: Role,
  targetRole: Role,
  defs: RoleDefinition[],
): boolean {
  if (!targetRole) return false;
  if (actorRole === OWNER_ROLE_KEY) return true;
  if (ELEVATED_SET.has(targetRole)) return false;
  return rankOf(targetRole, defs) > rankOf(actorRole, defs);
}

/** Roles the actor may invite or assign — subordinates only (owner: all). */
export function rolesAssignableBy(actorRole: Role, defs: RoleDefinition[]): Role[] {
  return orderedRoles(defs)
    .map((d) => d.key)
    .filter((key) => canAssignRole(actorRole, key, defs));
}

export function actorCanAccessAllStores(actorRole: Role, defs: RoleDefinition[]): boolean {
  return capability(actorRole, defs, 'canAccessAllStores');
}

/** Stores the actor may attach on invite/approve. */
export function storesSelectableBy(
  actorRole: Role,
  actorStoreIds: string[],
  allStores: Store[],
  defs: RoleDefinition[],
): Store[] {
  if (actorCanAccessAllStores(actorRole, defs)) return allStores;
  const allowed = new Set(actorStoreIds);
  return allStores.filter((s) => allowed.has(s.id));
}

export function assertStoreIdsAllowed(
  actorRole: Role,
  actorStoreIds: string[],
  storeIds: string[],
  defs: RoleDefinition[],
): string | null {
  if (actorCanAccessAllStores(actorRole, defs)) return null;
  const allowed = new Set(actorStoreIds);
  const illegal = storeIds.filter((id) => !allowed.has(id));
  if (!illegal.length) return null;
  return 'Forbidden: store selection outside your assigned stores';
}
