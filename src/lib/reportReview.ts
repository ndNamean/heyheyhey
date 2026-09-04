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

/**
 * Show Finalise when every item is approved, or optional not_started (will be
 * auto-approved on Finalise). Block waiting_approval, need_correction, rejected,
 * and required not_started.
 */
export function canFinaliseReportResponses(
  responses: Array<Pick<ReportResponse, 'status'> & { required?: boolean | null }>,
): boolean {
  if (!responses.length) return false;
  return responses.every(
    (r) =>
      r.status === 'approved' ||
      (r.status === 'not_started' && r.required === false),
  );
}

/**
 * Optional not_started rows Finalise will auto-approve in the same transaction.
 */
export function listOptionalNotStartedToApprove<
  T extends Pick<ReportResponse, 'status'> & { required?: boolean | null },
>(responses: T[]): T[] {
  return responses.filter(
    (r) => r.status === 'not_started' && r.required === false,
  );
}

/**
 * Remind in Store Chat when any item still needs store work
 * (need_correction, rejected, or any not_started). Waiting approval stays out.
 * Optional not_started is reviewer-nudge only (needs-action badge stays unchanged).
 */
export function canRemindReportInStoreChat(
  responses: Array<Pick<ReportResponse, 'status'> & { required?: boolean | null }>,
): boolean {
  return responses.some(
    (r) =>
      r.status === 'need_correction' ||
      r.status === 'rejected' ||
      r.status === 'not_started',
  );
}

/**
 * Prefer need_correction, then rejected, then required not_started, then optional
 * not_started — for Remind note / itemTitle.
 */
export function firstActionableReportResponse<
  T extends Pick<ReportResponse, 'status' | 'title' | 'rejectionReason' | 'feedbackNote'> & {
    required?: boolean | null;
  },
>(responses: T[]): T | null {
  const needCorrection = responses.find((r) => r.status === 'need_correction');
  if (needCorrection) return needCorrection;
  const rejected = responses.find((r) => r.status === 'rejected');
  if (rejected) return rejected;
  const requiredNotStarted = responses.find(
    (r) => r.status === 'not_started' && r.required !== false,
  );
  if (requiredNotStarted) return requiredNotStarted;
  return responses.find((r) => r.status === 'not_started') ?? null;
}

/**
 * Header status after Finalise: when Finalise is allowed, always `approved`
 * (optional not_started leftovers are auto-approved in the same tx).
 */
export function resolveFinaliseReportStatus(
  responses: Array<Pick<ReportResponse, 'status'> & { required?: boolean | null }>,
): FinaliseReportHeaderStatus {
  if (!canFinaliseReportResponses(responses)) return 'waiting_approval';
  return 'approved';
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
