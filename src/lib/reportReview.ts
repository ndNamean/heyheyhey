import { canApproveItem, canReview, userCanAccessStore } from './roles';
import type { Profile, Report, ReportResponse, Role, RoleDefinition } from '../types';

function profileStoreIds(profile: Profile): string[] {
  return (profile.stores ?? []).map((s) => s.id);
}

export type ReviewReportsWhereClause =
  | { storeId: { $in: string[] } }
  | { id: string }
  | { or: Array<{ storeId: { $in: string[] } } | { id: string }> };

/**
 * Instant `where` for Review reports.
 * `undefined` = no where (all-store roles). `null` = skip the reports query.
 * Never filters on `reports.status` (unindexed) — that made the Review list
 * flash from cache then empty after the server round-trip.
 */
export function buildReviewReportsWhere(opts: {
  canAccessAllStores: boolean;
  storeIds: string[];
  highlightReportId?: string | null;
}): ReviewReportsWhereClause | null | undefined {
  if (opts.canAccessAllStores) return undefined;
  const storeIds = [...new Set(opts.storeIds.filter(Boolean))];
  const highlightId = String(opts.highlightReportId || '').trim();
  if (storeIds.length && highlightId) {
    return { or: [{ storeId: { $in: storeIds } }, { id: highlightId }] };
  }
  if (storeIds.length) return { storeId: { $in: storeIds } };
  if (highlightId) return { id: highlightId };
  return null;
}

/** Header still waiting — Review list filter (client-side; do not Instant-where status). */
export function isReportAwaitingReview(report: Pick<Report, 'status'>): boolean {
  return report.status === 'waiting_approval';
}

export function filterReportsAwaitingReview(
  reports: Report[],
  profile: Profile,
  defs: RoleDefinition[],
): Report[] {
  return reports.filter(
    (r) => isReportAwaitingReview(r) && canReviewReport(profile, r, defs),
  );
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
