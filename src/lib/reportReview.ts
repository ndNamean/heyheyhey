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

/** Newest submitted first; id tie-break so Instant live updates cannot reshuffle the list. */
export function sortReportsAwaitingReview(reports: Report[]): Report[] {
  return [...reports].sort((a, b) => {
    const byTime = (b.submittedAt || '').localeCompare(a.submittedAt || '');
    if (byTime) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function filterReportsAwaitingReview(
  reports: Report[],
  profile: Profile,
  defs: RoleDefinition[],
): Report[] {
  return sortReportsAwaitingReview(
    reports.filter((r) => isReportAwaitingReview(r) && canReviewReport(profile, r, defs)),
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

/** Item statuses that count as reviewed (no pending waiting_approval left). */
export const FINALISE_READY_ITEM_STATUSES = [
  'approved',
  'rejected',
  'need_correction',
] as const;

export type FinaliseReportHeaderStatus =
  | 'approved'
  | 'rejected'
  | 'need_correction'
  | 'waiting_approval';

function everyResponseReviewed(
  responses: Pick<ReportResponse, 'status'>[],
): boolean {
  if (!responses.length) return false;
  return responses.every((r) =>
    (FINALISE_READY_ITEM_STATUSES as readonly string[]).includes(r.status),
  );
}

/** Show Finalise only when every item is Approved. */
export function canFinaliseReportResponses(
  responses: Pick<ReportResponse, 'status'>[],
): boolean {
  if (!responses.length) return false;
  return responses.every((r) => r.status === 'approved');
}

/**
 * Remind in Store Chat when every item is reviewed but not all approved
 * (mixed approved + need_correction / rejected). Hidden while any item waits.
 */
export function canRemindReportInStoreChat(
  responses: Pick<ReportResponse, 'status'>[],
): boolean {
  if (!everyResponseReviewed(responses)) return false;
  return !responses.every((r) => r.status === 'approved');
}

/** Prefer need_correction, else rejected — for Remind note / itemTitle. */
export function firstActionableReportResponse<
  T extends Pick<ReportResponse, 'status' | 'title' | 'rejectionReason' | 'feedbackNote'>,
>(responses: T[]): T | null {
  const needCorrection = responses.find((r) => r.status === 'need_correction');
  if (needCorrection) return needCorrection;
  return responses.find((r) => r.status === 'rejected') ?? null;
}

/**
 * Header status after Finalise:
 * all approved → approved; any rejected → rejected; else any need_correction → need_correction.
 * (With all-approved Finalise gating, only `approved` is reachable from the button.)
 */
export function resolveFinaliseReportStatus(
  responses: Pick<ReportResponse, 'status'>[],
): FinaliseReportHeaderStatus {
  if (!canFinaliseReportResponses(responses)) return 'waiting_approval';
  if (responses.every((r) => r.status === 'approved')) return 'approved';
  if (responses.some((r) => r.status === 'rejected')) return 'rejected';
  if (responses.some((r) => r.status === 'need_correction')) return 'need_correction';
  return 'waiting_approval';
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
