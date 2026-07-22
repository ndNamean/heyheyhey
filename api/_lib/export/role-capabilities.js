/**
 * Default role capabilities for export RBAC (mirrors src/lib/defaultRoleDefinitions.ts).
 */

const DEFAULT_CAPS = {
  owner: { canExportDashboard: true, canExportReviewStatus: false },
  admin: { canExportDashboard: true, canExportReviewStatus: false },
  areaManager: { canExportDashboard: true, canExportReviewStatus: false },
  manager: { canExportDashboard: false, canExportReviewStatus: true },
  leader: { canExportDashboard: false, canExportReviewStatus: true },
  subleader: { canExportDashboard: false, canExportReviewStatus: true },
  staff: { canExportDashboard: false, canExportReviewStatus: false },
  viewer: { canExportDashboard: false, canExportReviewStatus: false },
};

/** Instant has:one may arrive as an object or a one-element array. */
export function unwrapLinkedEntity(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * Resolve the role definition the same way the client Capabilities matrix does:
 * look up by profile.role key in roleDefinitions, then fall back to the linked entity.
 */
export function resolveRoleDefinition(profile, allDefs) {
  const defs = allDefs ?? [];
  const byKey = defs.find((d) => d.key === profile.role && d.active !== false) ?? null;
  if (byKey) return byKey;
  return unwrapLinkedEntity(profile?.roleDefinition);
}

/** Matches client `canManageUsers(role, defs)` + legacy hardcoded owners. */
export function roleCanManageUsers(role, roleDefinition) {
  const def = unwrapLinkedEntity(roleDefinition);
  if (def && typeof def === 'object' && 'canManageUsers' in def) {
    return !!def.canManageUsers;
  }
  return role === 'owner' || role === 'areaManager' || role === 'admin';
}

export function getRoleCapabilities(role, roleDefinition) {
  const def = unwrapLinkedEntity(roleDefinition) ?? roleDefinition;
  if (def) {
    return {
      canExportDashboard: !!def.canExportDashboard,
      canExportReviewStatus: !!def.canExportReviewStatus,
    };
  }
  return DEFAULT_CAPS[role] ?? { canExportDashboard: false, canExportReviewStatus: false };
}
