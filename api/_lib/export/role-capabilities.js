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

export function getRoleCapabilities(role, roleDefinition) {
  if (roleDefinition) {
    return {
      canExportDashboard: !!roleDefinition.canExportDashboard,
      canExportReviewStatus: !!roleDefinition.canExportReviewStatus,
    };
  }
  return DEFAULT_CAPS[role] ?? { canExportDashboard: false, canExportReviewStatus: false };
}
