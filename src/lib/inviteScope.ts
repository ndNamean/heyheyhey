import { orderedRoles, rankOf, capability } from './roleResolver';
import { parseAccessReviewStoreIds } from './accessReview';
import {
  ELEVATED_ASSIGN_ROLE_KEYS,
  OWNER_ROLE_KEY,
  type Profile,
  type Role,
  type RoleDefinition,
  type Store,
} from '../types';

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

/** Linked stores, else invite/review store hints (for pending users). */
export function profileVisibilityStoreIds(profile: Profile): string[] {
  const linked = (profile.stores ?? []).map((s) => s.id);
  if (linked.length) return linked;
  const invited = parseAccessReviewStoreIds(profile.invitedStoreIdsJson);
  if (invited.length) return invited;
  return parseAccessReviewStoreIds(profile.accessReviewStoreIdsJson);
}

/**
 * Whether actor may see target on Users / access queues.
 * - Owner is never visible to non-owners.
 * - Non-owners only see strictly subordinate roles.
 * - Without canAccessAllStores, target must share at least one store (or invite hint).
 */
export function canViewManagedProfile(
  actorRole: Role,
  target: Profile,
  actorStoreIds: string[],
  defs: RoleDefinition[],
): boolean {
  if (target.role === OWNER_ROLE_KEY && actorRole !== OWNER_ROLE_KEY) {
    return false;
  }
  if (actorRole === OWNER_ROLE_KEY) return true;
  if (!canAssignRole(actorRole, target.role, defs)) return false;
  if (actorCanAccessAllStores(actorRole, defs)) return true;

  const targetStores = profileVisibilityStoreIds(target);
  if (!targetStores.length) return false;
  const allowed = new Set(actorStoreIds);
  return targetStores.some((id) => allowed.has(id));
}

export function filterManagedProfiles(
  actorRole: Role,
  actorStoreIds: string[],
  profiles: Profile[],
  defs: RoleDefinition[],
  options?: { excludeProfileId?: string },
): Profile[] {
  return profiles.filter((p) => {
    if (options?.excludeProfileId && p.id === options.excludeProfileId) return false;
    return canViewManagedProfile(actorRole, p, actorStoreIds, defs);
  });
}
