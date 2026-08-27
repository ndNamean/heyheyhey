import { formatIsoToLocalTime } from './proofTime';
import { userCanAccessStore } from './roles';
import { buildReportTimeline } from './reviewTimeline';
import type { Profile, Report, ReportResponse, ReviewEvent, Role, RoleDefinition } from '../types';

export interface ReportReviewStatusRow {
  report: Report;
  reportDate: string;
  storeCode: string;
  submittedBy: string;
  submittedTime: string;
  status: string;
  latestReviewTime: string;
  latestFeedback: string;
  finalizedTime: string;
  leadTimeMs: number | null;
  correctionDurationMs: number | null;
  timelineSource: 'events' | 'inferred' | 'mixed';
}

export interface ReportReviewStatusSummary {
  pending: number;
  needCorrection: number;
  rejected: number;
  approved: number;
}

export interface BuildReportReviewStatusOptions {
  profile: Profile;
  defs?: RoleDefinition[];
  daysBack?: number;
  limit?: number;
  now?: Date;
}

export const REVIEW_STATUS_DAYS_BACK = 30;
export const REVIEW_STATUS_DISPLAY_LIMIT = 20;
export const REVIEW_STATUS_QUERY_LIMIT = 200;

export type ReportReviewStatusWhereClause =
  | {
      storeId: { $in: string[] };
      reportDate: { $gte: string; $lte: string };
    }
  | {
      reportDate: { $gte: string; $lte: string };
    };

export interface BuildReportReviewStatusWhereOptions {
  canAccessAllStores: boolean;
  storeIds: string[];
  daysBack?: number;
  now?: Date;
}

/** Inclusive YYYY-MM-DD window used by Instant `where` and the client safety filter. */
export function reviewStatusDateWindow(
  daysBack: number = REVIEW_STATUS_DAYS_BACK,
  now: Date = new Date(),
): { start: string; end: string } {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  start.setDate(start.getDate() - daysBack);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/**
 * Instant `where` for the manager-home review-status table.
 * Store-scoped reviewers with no stores skip the reports query (`null`).
 */
export function buildReportReviewStatusWhere(
  opts: BuildReportReviewStatusWhereOptions,
): ReportReviewStatusWhereClause | null {
  const daysBack = opts.daysBack ?? REVIEW_STATUS_DAYS_BACK;
  const { start, end } = reviewStatusDateWindow(daysBack, opts.now);
  const reportDate = { $gte: start, $lte: end };
  if (opts.canAccessAllStores) return { reportDate };
  const storeIds = [...new Set(opts.storeIds.filter(Boolean))];
  if (!storeIds.length) return null;
  return { storeId: { $in: storeIds }, reportDate };
}

const STATUS_ORDER: Record<string, number> = {
  waiting_approval: 0,
  need_correction: 1,
  rejected: 2,
  approved: 3,
};

function parseMs(iso?: string): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDisplay(iso?: string): string {
  if (!iso?.trim()) return '—';
  return formatIsoToLocalTime(iso);
}

function resolveSubmitterName(report: Report, profiles: Profile[]): string {
  const profile = profiles.find((p) => p.userId === report.submittedByUserId);
  if (profile?.displayName?.trim()) return profile.displayName.trim();
  if (profile?.email) return profile.email.split('@')[0] ?? profile.email;
  return report.submittedByRole || '—';
}

function latestReviewIso(report: Report, events: ReviewEvent[]): string | null {
  const responses = (report.responses ?? []) as ReportResponse[];
  const responseTimes = responses
    .map((r) => r.approvedAt)
    .filter((t) => t?.trim());

  const reviewEventTypes = new Set(['item_approved', 'item_rejected', 'item_correction', 'report_finalized']);
  const eventTimes = events
    .filter((e) => e.reportId === report.id && reviewEventTypes.has(e.eventType))
    .map((e) => e.createdAt);

  const all = [...responseTimes, ...eventTimes].sort((a, b) => b.localeCompare(a));
  return all[0] ?? null;
}

function latestFeedbackNote(report: Report, events: ReviewEvent[]): string {
  const responses = (report.responses ?? []) as ReportResponse[];
  const flagged = responses.filter((r) =>
    ['rejected', 'need_correction'].includes(r.status) && r.rejectionReason?.trim(),
  );
  if (flagged.length) {
    const sorted = [...flagged].sort((a, b) =>
      (b.updatedAt || b.approvedAt || '').localeCompare(a.updatedAt || a.approvedAt || ''),
    );
    return sorted[0]!.rejectionReason.trim();
  }

  const feedbackEvents = events
    .filter(
      (e) =>
        e.reportId === report.id &&
        (e.eventType === 'item_correction' || e.eventType === 'item_rejected') &&
        e.note?.trim(),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return feedbackEvents[0]?.note?.trim() ?? '';
}

export function computeCorrectionDurationMs(events: ReviewEvent[], reportId: string): number | null {
  const reportEvents = events
    .filter((e) => e.reportId === reportId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let maxGap: number | null = null;

  for (let i = 0; i < reportEvents.length; i++) {
    const ev = reportEvents[i]!;
    if (ev.eventType !== 'item_correction' && ev.eventType !== 'item_rejected') continue;

    const correctionMs = parseMs(ev.createdAt);
    if (correctionMs == null) continue;

    const resubmit = reportEvents
      .slice(i + 1)
      .find((e) => e.eventType === 'resubmitted' && e.createdAt > ev.createdAt);

    if (!resubmit) continue;

    const resubmitMs = parseMs(resubmit.createdAt);
    if (resubmitMs == null) continue;

    const gap = resubmitMs - correctionMs;
    if (gap >= 0 && (maxGap == null || gap > maxGap)) {
      maxGap = gap;
    }
  }

  return maxGap;
}

function isWithinDateWindow(reportDate: string, daysBack: number, now?: Date): boolean {
  if (!reportDate?.trim()) return false;
  const { start, end } = reviewStatusDateWindow(daysBack, now);
  return reportDate >= start && reportDate <= end;
}

function sortReports(a: Report, b: Report): number {
  const orderA = STATUS_ORDER[a.status] ?? 99;
  const orderB = STATUS_ORDER[b.status] ?? 99;
  if (orderA !== orderB) return orderA - orderB;
  return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
}

export function buildReportReviewStatusSummary(rows: ReportReviewStatusRow[]): ReportReviewStatusSummary {
  const summary: ReportReviewStatusSummary = {
    pending: 0,
    needCorrection: 0,
    rejected: 0,
    approved: 0,
  };

  for (const row of rows) {
    if (row.status === 'waiting_approval') summary.pending++;
    else if (row.status === 'need_correction') summary.needCorrection++;
    else if (row.status === 'rejected') summary.rejected++;
    else if (row.status === 'approved') summary.approved++;
  }

  return summary;
}

export function buildReportReviewStatusRows(
  reports: Report[],
  profiles: Profile[],
  events: ReviewEvent[],
  options: BuildReportReviewStatusOptions,
): ReportReviewStatusRow[] {
  const {
    profile,
    defs,
    daysBack = REVIEW_STATUS_DAYS_BACK,
    limit = REVIEW_STATUS_DISPLAY_LIMIT,
    now,
  } = options;
  const storeIds = (profile.stores ?? []).map((s) => s.id);

  const filtered = reports
    .filter((r) => userCanAccessStore(profile.role as Role, storeIds, r.storeId, defs))
    .filter((r) => isWithinDateWindow(r.reportDate, daysBack, now))
    .sort(sortReports)
    .slice(0, limit);

  return filtered.map((report) => {
    const reportEvents = events.filter((e) => e.reportId === report.id);
    const timeline = buildReportTimeline(report, reportEvents);
    const latestReview = latestReviewIso(report, reportEvents);

    return {
      report,
      reportDate: report.reportDate,
      storeCode: report.storeCode,
      submittedBy: resolveSubmitterName(report, profiles),
      submittedTime: formatDisplay(report.submittedAt),
      status: report.status,
      latestReviewTime: formatDisplay(latestReview ?? undefined),
      latestFeedback: latestFeedbackNote(report, reportEvents),
      finalizedTime: timeline.finalizedAt ? formatDisplay(timeline.finalizedAt) : '—',
      leadTimeMs: timeline.totalDurationMs,
      correctionDurationMs: computeCorrectionDurationMs(events, report.id),
      timelineSource: timeline.source,
    };
  });
}
