/**
 * Role-based access control for export endpoints.
 */

import { getRoleCapabilities } from './role-capabilities.js';

export function assertDashboardExportRole(role, roleDefinition) {
  const caps = getRoleCapabilities(role, roleDefinition);
  if (!caps.canExportDashboard) {
    const err = new Error('Forbidden: dashboard export requires canExportDashboard capability');
    err.status = 403;
    throw err;
  }
}

export function assertReviewStatusExportRole(role, roleDefinition) {
  const caps = getRoleCapabilities(role, roleDefinition);
  if (!caps.canExportReviewStatus) {
    const err = new Error('Forbidden: review status export requires canExportReviewStatus capability');
    err.status = 403;
    throw err;
  }
}

export function assertExportJobAccess(role, exportType, roleDefinition) {
  if (exportType === 'dashboard' || exportType === 'failure_history') {
    assertDashboardExportRole(role, roleDefinition);
  } else if (exportType === 'review_status') {
    assertReviewStatusExportRole(role, roleDefinition);
  } else {
    const err = new Error('Invalid export type');
    err.status = 400;
    throw err;
  }
}
