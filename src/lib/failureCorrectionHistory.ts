import type { Profile, Report, ReportResponse, ReviewEvent } from '../types';

export type IssueType = 'rejected' | 'need_correction';

export interface IssueInstance {
  id: string;
  eventId: string;
  reportId: string;
  reportResponseId: string;
  templateItemId: string;
  storeId: string;
  itemTitle: string;
  section: string;
  category: string;
  issueType: IssueType;
  issueAt: string;
  issueByUserId: string;
  issueByRole: string;
  issueByName: string;
  rejectionReason: string;
  feedbackCode: string;
  feedbackNote: string;
  resubmittedAt: string | null;
  resubmittedByUserId: string | null;
  resubmittedByRole: string | null;
  resubmittedByName: string | null;
  correctionDurationMs: number | null;
  nextReviewAt: string | null;
  nextReviewByUserId: string | null;
  nextReviewByRole: string | null;
  nextReviewByName: string | null;
  nextReviewDecision: string | null;
  rereviewDurationMs: number | null;
  finalApprovedAt: string | null;
  finalApprovedByUserId: string | null;
  finalApprovedByRole: string | null;
  finalApprovedByName: string | null;
  timeToFinalApprovalMs: number | null;
  cycleNumber: number;
  currentStatus: string;
  reportFinalStatus: string;
  reportDate: string;
  storeCode: string;
  templateName: string;
  originalSubmittedByUserId: string;
  originalSubmittedByRole: string;
  originalSubmittedAt: string | null;
}

export interface FailureHistoryKpis {
  issueRate: { percent: number; numerator: number; denominator: number };
  strictRejectionRate: { percent: number; numerator: number; denominator: number };
  correctionRequestRate: { percent: number; numerator: number; denominator: number };
  correctionRecoveryRate: { percent: number; numerator: number; denominator: number };
  approvalRecoveryRate: { percent: number; numerator: number; denominator: number };
  avgCorrectionTimeMs: number | null;
  medianCorrectionTimeMs: number | null;
  fastestCorrectionTimeMs: number | null;
  slowestCorrectionTimeMs: number | null;
  completedCorrectionCycles: number;
  openCorrections: number;
  avgRereviewTimeMs: number | null;
  avgTimeToFinalApprovalMs: number | null;
  repeatFailureRate: { percent: number; numerator: number; denominator: number };
}

export interface TrendBucket {
  label: string;
  startDate: string;
  issueRate: number;
  strictRejectionRate: number;
  correctionRequestRate: number;
  correctionRecoveryRate: number;
  approvalRecoveryRate: number;
  avgCorrectionTimeMs: number | null;
  issueCount: number;
}

export interface BreakdownRow {
  key: string;
  itemTitle: string;
  section: string;
  category: string;
  storeCode: string;
  templateItemId: string;
  reviewCycles: number;
  rejectedCount: number;
  correctionCount: number;
  issueCount: number;
  issueRate: number;
  resubmittedCount: number;
  approvedAfterCorrectionCount: number;
  recoveryRate: number;
  repeatedIssueCount: number;
  avgCorrectionTimeMs: number | null;
  avgRereviewTimeMs: number | null;
  avgTimeToFinalApprovalMs: number | null;
}

export interface FailureHistoryResult {
  kpis: FailureHistoryKpis;
  trendBuckets: TrendBucket[];
  breakdownRows: BreakdownRow[];
  issueInstances: IssueInstance[];
  trackingSince: string | null;
  hasPartialData: boolean;
}

export interface FailureHistoryFilters {
  from: string;
  to: string;
  storeIds: string[] | null;
  issueType?: 'all' | 'rejected' | 'need_correction';
  section?: string;
  category?: string;
}

const DECISION_TYPES = new Set(['item_approved', 'item_rejected', 'item_correction']);
const ISSUE_TYPES = new Set(['item_rejected', 'item_correction']);

function parseMs(iso?: string | null): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function dateInRange(iso: string, from: string, to: string): boolean {
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

function actorName(
  userId: string,
  snapshot: string | undefined,
  profiles: Profile[],
): string {
  if (snapshot?.trim()) return snapshot.trim();
  const p = profiles.find((x) => x.userId === userId);
  if (p?.displayName?.trim()) return p.displayName.trim();
  if (p?.email) return p.email.split('@')[0] ?? p.email;
  if (userId) return `Former user — ${userId.slice(0, 8)}`;
  return 'Unknown';
}

function dedupeEvents(events: ReviewEvent[]): ReviewEvent[] {
  const seen = new Set<string>();
  const out: ReviewEvent[] = [];
  for (const e of events) {
    const key = `${e.reportResponseId}|${e.eventType}|${e.createdAt}|${e.actorUserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function buildResponseMeta(
  reports: Report[],
  responsesById: Map<string, ReportResponse & { report: Report }>,
) {
  for (const report of reports) {
    for (const resp of (report.responses ?? []) as ReportResponse[]) {
      responsesById.set(resp.id, { ...resp, report });
    }
  }
}

export function buildIssueInstances(
  events: ReviewEvent[],
  reports: Report[],
  profiles: Profile[],
): IssueInstance[] {
  const responsesById = new Map<string, ReportResponse & { report: Report }>();
  buildResponseMeta(reports, responsesById);

  const reportById = new Map(reports.map((r) => [r.id, r]));
  const sorted = dedupeEvents([...events]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const instances: IssueInstance[] = [];
  const issueCountByResponse = new Map<string, number>();

  for (const ev of sorted) {
    if (!ISSUE_TYPES.has(ev.eventType) || !ev.reportResponseId) continue;

    const respMeta = responsesById.get(ev.reportResponseId);
    const report = reportById.get(ev.reportId);
    const cycleNum = (issueCountByResponse.get(ev.reportResponseId) ?? 0) + 1;
    issueCountByResponse.set(ev.reportResponseId, cycleNum);

    const responseEvents = sorted.filter((e) => e.reportResponseId === ev.reportResponseId);
    const afterIssue = responseEvents.filter((e) => e.createdAt > ev.createdAt);

    const resubmit = afterIssue.find((e) => e.eventType === 'resubmitted');
    const nextDecision = afterIssue.find((e) => DECISION_TYPES.has(e.eventType));
    const finalApproval = afterIssue.find((e) => e.eventType === 'item_approved');

    const firstSubmit = responseEvents.find((e) => e.eventType === 'submitted');

    const issueMs = parseMs(ev.createdAt);
    const resubmitMs = resubmit ? parseMs(resubmit.createdAt) : null;
    const nextDecisionMs = nextDecision ? parseMs(nextDecision.createdAt) : null;
    const finalApprovalMs = finalApproval ? parseMs(finalApproval.createdAt) : null;

    instances.push({
      id: `${ev.id}-${cycleNum}`,
      eventId: ev.id,
      reportId: ev.reportId,
      reportResponseId: ev.reportResponseId,
      templateItemId: ev.templateItemId || respMeta?.templateItemId || '',
      storeId: ev.storeId,
      itemTitle: ev.itemTitle || respMeta?.title || '',
      section: ev.sectionSnapshot || respMeta?.section || '',
      category: ev.categorySnapshot || respMeta?.failureCategory || '',
      issueType: ev.eventType === 'item_rejected' ? 'rejected' : 'need_correction',
      issueAt: ev.createdAt,
      issueByUserId: ev.actorUserId,
      issueByRole: ev.actorRole,
      issueByName: actorName(ev.actorUserId, ev.actorDisplayNameSnapshot, profiles),
      rejectionReason: ev.note || '',
      feedbackCode: ev.feedbackCode || '',
      feedbackNote: ev.feedbackNote || '',
      resubmittedAt: resubmit?.createdAt ?? null,
      resubmittedByUserId: resubmit?.actorUserId ?? null,
      resubmittedByRole: resubmit?.actorRole ?? null,
      resubmittedByName: resubmit
        ? actorName(resubmit.actorUserId, resubmit.actorDisplayNameSnapshot, profiles)
        : null,
      correctionDurationMs:
        issueMs != null && resubmitMs != null ? resubmitMs - issueMs : null,
      nextReviewAt: nextDecision?.createdAt ?? null,
      nextReviewByUserId: nextDecision?.actorUserId ?? null,
      nextReviewByRole: nextDecision?.actorRole ?? null,
      nextReviewByName: nextDecision
        ? actorName(nextDecision.actorUserId, nextDecision.actorDisplayNameSnapshot, profiles)
        : null,
      nextReviewDecision: nextDecision?.statusAfter ?? null,
      rereviewDurationMs:
        resubmitMs != null && nextDecisionMs != null ? nextDecisionMs - resubmitMs : null,
      finalApprovedAt: finalApproval?.createdAt ?? null,
      finalApprovedByUserId: finalApproval?.actorUserId ?? null,
      finalApprovedByRole: finalApproval?.actorRole ?? null,
      finalApprovedByName: finalApproval
        ? actorName(finalApproval.actorUserId, finalApproval.actorDisplayNameSnapshot, profiles)
        : null,
      timeToFinalApprovalMs:
        issueMs != null && finalApprovalMs != null ? finalApprovalMs - issueMs : null,
      cycleNumber: cycleNum,
      currentStatus: respMeta?.status ?? '',
      reportFinalStatus: report?.status ?? '',
      reportDate: report?.reportDate ?? '',
      storeCode: report?.storeCode ?? '',
      templateName: report?.templateName ?? '',
      originalSubmittedByUserId:
        firstSubmit?.actorUserId || respMeta?.submittedByUserId || report?.submittedByUserId || '',
      originalSubmittedByRole:
        firstSubmit?.actorRole || respMeta?.submittedByRole || report?.submittedByRole || '',
      originalSubmittedAt: firstSubmit?.createdAt ?? respMeta?.submittedAt ?? report?.submittedAt ?? null,
    });
  }

  return instances;
}

function filterInstances(instances: IssueInstance[], filters: FailureHistoryFilters): IssueInstance[] {
  return instances.filter((inst) => {
    if (!dateInRange(inst.issueAt, filters.from, filters.to)) return false;
    if (filters.storeIds && !filters.storeIds.includes(inst.storeId)) return false;
    if (filters.issueType === 'rejected' && inst.issueType !== 'rejected') return false;
    if (filters.issueType === 'need_correction' && inst.issueType !== 'need_correction') return false;
    if (filters.section && inst.section !== filters.section) return false;
    if (filters.category && inst.category !== filters.category) return false;
    return true;
  });
}

function computeKpis(
  instances: IssueInstance[],
  allEvents: ReviewEvent[],
  filters: FailureHistoryFilters,
): FailureHistoryKpis {
  const scopedDecisions = allEvents.filter(
    (e) =>
      DECISION_TYPES.has(e.eventType) &&
      dateInRange(e.createdAt, filters.from, filters.to) &&
      (!filters.storeIds || filters.storeIds.includes(e.storeId)),
  );

  const rejected = scopedDecisions.filter((e) => e.eventType === 'item_rejected').length;
  const corrections = scopedDecisions.filter((e) => e.eventType === 'item_correction').length;
  const approved = scopedDecisions.filter((e) => e.eventType === 'item_approved').length;
  const denominator = scopedDecisions.length;

  const resubmitted = instances.filter((i) => i.resubmittedAt).length;
  const eventuallyApproved = instances.filter((i) => i.finalApprovedAt).length;
  const open = instances.filter((i) => !i.resubmittedAt).length;

  const correctionDurations = instances
    .map((i) => i.correctionDurationMs)
    .filter((ms): ms is number => ms != null && ms >= 0);
  const rereviewDurations = instances
    .map((i) => i.rereviewDurationMs)
    .filter((ms): ms is number => ms != null && ms >= 0);
  const finalApprovalDurations = instances
    .map((i) => i.timeToFinalApprovalMs)
    .filter((ms): ms is number => ms != null && ms >= 0);

  const responsesWithIssues = new Set(instances.map((i) => i.reportResponseId));
  const responsesWithRepeat = new Set(
    instances
      .filter((i) => i.cycleNumber >= 2)
      .map((i) => i.reportResponseId),
  );
  // Count responses with 2+ issue events total
  const issueCountByResponse = new Map<string, number>();
  for (const i of instances) {
    issueCountByResponse.set(i.reportResponseId, (issueCountByResponse.get(i.reportResponseId) ?? 0) + 1);
  }
  let repeatResponses = 0;
  for (const count of issueCountByResponse.values()) {
    if (count >= 2) repeatResponses++;
  }

  return {
    issueRate: { percent: pct(rejected + corrections, denominator), numerator: rejected + corrections, denominator },
    strictRejectionRate: { percent: pct(rejected, denominator), numerator: rejected, denominator },
    correctionRequestRate: { percent: pct(corrections, denominator), numerator: corrections, denominator },
    correctionRecoveryRate: {
      percent: pct(resubmitted, instances.length),
      numerator: resubmitted,
      denominator: instances.length,
    },
    approvalRecoveryRate: {
      percent: pct(eventuallyApproved, instances.length),
      numerator: eventuallyApproved,
      denominator: instances.length,
    },
    avgCorrectionTimeMs: avg(correctionDurations),
    medianCorrectionTimeMs: median(correctionDurations),
    fastestCorrectionTimeMs: correctionDurations.length ? Math.min(...correctionDurations) : null,
    slowestCorrectionTimeMs: correctionDurations.length ? Math.max(...correctionDurations) : null,
    completedCorrectionCycles: correctionDurations.length,
    openCorrections: open,
    avgRereviewTimeMs: avg(rereviewDurations),
    avgTimeToFinalApprovalMs: avg(finalApprovalDurations),
    repeatFailureRate: {
      percent: pct(repeatResponses, responsesWithIssues.size),
      numerator: repeatResponses,
      denominator: responsesWithIssues.size,
    },
  };
}

function buildTrendBuckets(
  instances: IssueInstance[],
  allEvents: ReviewEvent[],
  filters: FailureHistoryFilters,
): TrendBucket[] {
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime();
  const daySpan = Math.ceil((toMs - fromMs) / 86400000);
  const useMonthly = daySpan > 90;

  const buckets = new Map<string, IssueInstance[]>();

  for (const inst of instances) {
    const d = new Date(inst.issueAt);
    const label = useMonthly
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : inst.issueAt.slice(0, 10);
    const list = buckets.get(label) ?? [];
    list.push(inst);
    buckets.set(label, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, bucketInstances]) => {
      const startDate = useMonthly ? `${label}-01` : label;
      const endDate = useMonthly ? label : label;
      const subFilters: FailureHistoryFilters = { ...filters, from: startDate, to: endDate };
      const kpis = computeKpis(bucketInstances, allEvents, subFilters);
      return {
        label,
        startDate,
        issueRate: kpis.issueRate.percent,
        strictRejectionRate: kpis.strictRejectionRate.percent,
        correctionRequestRate: kpis.correctionRequestRate.percent,
        correctionRecoveryRate: kpis.correctionRecoveryRate.percent,
        approvalRecoveryRate: kpis.approvalRecoveryRate.percent,
        avgCorrectionTimeMs: kpis.avgCorrectionTimeMs,
        issueCount: bucketInstances.length,
      };
    });
}

function buildBreakdownRows(instances: IssueInstance[]): BreakdownRow[] {
  const byKey = new Map<string, IssueInstance[]>();

  for (const inst of instances) {
    const key = `${inst.templateItemId}|${inst.storeId}|${inst.itemTitle}`;
    const list = byKey.get(key) ?? [];
    list.push(inst);
    byKey.set(key, list);
  }

  const rows: BreakdownRow[] = [];

  for (const [key, group] of byKey) {
    const first = group[0]!;
    const rejectedCount = group.filter((i) => i.issueType === 'rejected').length;
    const correctionCount = group.filter((i) => i.issueType === 'need_correction').length;
    const resubmittedCount = group.filter((i) => i.resubmittedAt).length;
    const approvedCount = group.filter((i) => i.finalApprovedAt).length;
    const responseIds = new Set(group.map((i) => i.reportResponseId));
    const repeatedIssueCount = [...responseIds].filter((rid) => {
      return group.filter((i) => i.reportResponseId === rid).length >= 2;
    }).length;

    const correctionTimes = group
      .map((i) => i.correctionDurationMs)
      .filter((ms): ms is number => ms != null);
    const rereviewTimes = group
      .map((i) => i.rereviewDurationMs)
      .filter((ms): ms is number => ms != null);
    const finalTimes = group
      .map((i) => i.timeToFinalApprovalMs)
      .filter((ms): ms is number => ms != null);

    const reviewCycles = group.length;

    rows.push({
      key,
      itemTitle: first.itemTitle,
      section: first.section,
      category: first.category,
      storeCode: first.storeCode,
      templateItemId: first.templateItemId,
      reviewCycles,
      rejectedCount,
      correctionCount,
      issueCount: group.length,
      issueRate: pct(group.length, reviewCycles + approvedCount || 1),
      resubmittedCount,
      approvedAfterCorrectionCount: approvedCount,
      recoveryRate: pct(resubmittedCount, group.length),
      repeatedIssueCount,
      avgCorrectionTimeMs: avg(correctionTimes),
      avgRereviewTimeMs: avg(rereviewTimes),
      avgTimeToFinalApprovalMs: avg(finalTimes),
    });
  }

  return rows.sort((a, b) => b.issueCount - a.issueCount);
}

export function aggregateFailureCorrectionHistory(
  events: ReviewEvent[],
  reports: Report[],
  profiles: Profile[],
  filters: FailureHistoryFilters,
): FailureHistoryResult {
  const allInstances = buildIssueInstances(events, reports, profiles);
  const instances = filterInstances(allInstances, filters);

  const eventDates = events.map((e) => e.createdAt).filter(Boolean).sort();
  const trackingSince = eventDates[0] ?? null;
  const hasPartialData = reports.some((r) => {
    const reportEvents = events.filter((e) => e.reportId === r.id);
    return reportEvents.length === 0 && (r.responses ?? []).some((resp) =>
      ['rejected', 'need_correction', 'approved'].includes((resp as ReportResponse).status),
    );
  });

  return {
    kpis: computeKpis(instances, events, filters),
    trendBuckets: buildTrendBuckets(instances, events, filters),
    breakdownRows: buildBreakdownRows(instances),
    issueInstances: instances,
    trackingSince,
    hasPartialData,
  };
}

/** Unchanged Failed items logic — exported for regression tests */
export function computeFailedItemsMetric(
  reports: Report[],
): Array<{ title: string; section: string; failureCategory: string; count: number }> {
  const failMap: Record<string, { title: string; section: string; failureCategory: string; count: number }> = {};
  for (const report of reports) {
    for (const resp of (report.responses ?? []) as ReportResponse[]) {
      if (resp.status === 'rejected') {
        const key = resp.title;
        if (!failMap[key]) {
          failMap[key] = {
            title: resp.title,
            section: resp.section,
            failureCategory: resp.failureCategory,
            count: 0,
          };
        }
        failMap[key].count++;
      }
    }
  }
  return Object.values(failMap).sort((a, b) => b.count - a.count);
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}
