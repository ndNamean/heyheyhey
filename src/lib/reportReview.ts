import { canApproveItem, canReview, userCanAccessStore } from './roles';
import type { Profile, Report, ReportResponse, Role, RoleDefinition } from '../types';

function profileStoreIds(profile: Profile): string[] {
  return (profile.stores ?? []).map((s) => s.id);
}

/** Whether the profile may review / finalize this checklist report (role + store). */
export function canReviewReport(
  profile: Profile,
  report: Pick<Report, 'storeId'>,
  defs: RoleDefinition[],
): boolean {
  if (profile.approvalStatus !== 'approved') return false;
  if (!canReview(profile.role, defs)) return false;
  if (!report.storeId) return false;
  return userCanAccessStore(profile.role, profileStoreIds(profile), report.storeId, defs);
}

/** Whether the profile may approve/reject a single response item on the report. */
export function canReviewReportItem(
  profile: Profile,
  report: Pick<Report, 'storeId'>,
  response: Pick<ReportResponse, 'submittedByRole' | 'approverRolesJson'>,
  defs: RoleDefinition[],
): boolean {
  if (!canReviewReport(profile, report, defs)) return false;
  const approverRoles = JSON.parse(response.approverRolesJson || '[]') as Role[];
  return canApproveItem(
    response.submittedByRole as Role,
    profile.role,
    approverRoles,
    defs,
  );
}
