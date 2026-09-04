import { canApproveItem, canReview, userCanAccessStore } from './roles';
import type { Profile, Report, ReportResponse, Role, RoleDefinition } from '../types';

function profileStoreIds(profile: Profile): string[] {
  return (profile.stores ?? []).map((s) => s.id);
}

export type ReviewReportsWhereClause =
  | { status: 'waiting_approval' }
  | { and: [{ status: 'waiting_approval' }, { storeId: { $in: string[] } }] }
  | {
      or: [
        { and: [{ status: 'waiting_approval' }, { storeId: { $in: string[] } }] },
        { id: string },
      ];
    }
  | { id: string };

/**
 * Instant `where` for Review reports.
 * Filters on indexed `status: waiting_approval` for efficiency; `null` = skip
 * the reports namespace. Client still runs `filterReportsAwaitingReview`.
 */
export function buildReviewReportsWhere(opts: {
  canAccessAllStores: boolean;
  storeIds: string[];
  highlightReportId?: string | null;
}): ReviewReportsWhereClause | null {
  if (opts.canAccessAllStores) return { status: 'waiting_approval' };
  const storeIds = [...new Set(opts.storeIds.filter(Boolean))];
  const highlightId = String(opts.highlightReportId || '').trim();
  if (storeIds.length && highlightId) {
    return {
      or: [
        { and: [{ status: 'waiting_approval' }, { storeId: { $in: storeIds } }] },
        { id: highlightId },
      ],
    };
  }
  if (storeIds.length) {
    return { and: [{ status: 'waiting_approval' }, { storeId: { $in: storeIds } }] };
  }
  if (highlightId) return { id: highlightId };
  return null;
}

/** Header still waiting — Review list filter (client-side safety net). */
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

/** Show Finalise only when every item is Approved. */
export function canFinaliseReportResponses(
  responses: Pick<ReportResponse, 'status'>[],
): boolean {
  if (!responses.length) return false;
  return responses.every((r) => r.status === 'approved');
}

/**
 * Remind in Store Chat when any item still needs store work
 * (need_correction, rejected, or required not_started). Waiting approval stays out.
 * Aligns with isStoreWorkResponse so Remind cannot target optional not_started skips.
 */
export function canRemindReportInStoreChat(
  responses: Array<Pick<ReportResponse, 'status'> & { required?: boolean | null }>,
): boolean {
  return responses.some(
    (r) =>
      r.status === 'need_correction' ||
      r.status === 'rejected' ||
      (r.status === 'not_started' && r.required !== false),
  );
}

/** Prefer need_correction, then rejected, then required not_started — for Remind note / itemTitle. */
export function firstActionableReportResponse<
  T extends Pick<ReportResponse, 'status' | 'title' | 'rejectionReason' | 'feedbackNote'> & {
    required?: boolean | null;
  },
>(responses: T[]): T | null {
  const needCorrection = responses.find((r) => r.status === 'need_correction');
  if (needCorrection) return needCorrection;
  const rejected = responses.find((r) => r.status === 'rejected');
  if (rejected) return rejected;
  return (
    responses.find((r) => r.status === 'not_started' && r.required !== false) ?? null
  );
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
