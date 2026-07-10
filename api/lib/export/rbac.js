/**
 * Role-based access control for export endpoints.
 */

const DASHBOARD_ROLES = new Set(['owner', 'areaManager']);
const REVIEW_EXPORT_ROLES = new Set(['manager', 'leader', 'subleader']);
const DENIED_ROLES = new Set(['staff', 'viewer']);

export function assertDashboardExportRole(role) {
  if (DENIED_ROLES.has(role) || !DASHBOARD_ROLES.has(role)) {
    const err = new Error('Forbidden: dashboard export requires owner or areaManager role');
    err.status = 403;
    throw err;
  }
}

export function assertReviewStatusExportRole(role) {
  if (DENIED_ROLES.has(role) || !REVIEW_EXPORT_ROLES.has(role)) {
    const err = new Error('Forbidden: review status export requires manager, leader, or subleader role');
    err.status = 403;
    throw err;
  }
}

export function assertExportJobAccess(role, exportType) {
  if (exportType === 'dashboard') {
    assertDashboardExportRole(role);
  } else if (exportType === 'review_status') {
    assertReviewStatusExportRole(role);
  } else {
    const err = new Error('Invalid export type');
    err.status = 400;
    throw err;
  }
}
