/**
 * JS port of src/lib/reportReviewStatus.ts for server-side export.
 */

const STATUS_ORDER = {
  waiting_approval: 0,
  need_correction: 1,
  rejected: 2,
  approved: 3,
};

function parseMs(iso) {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDisplay(iso) {
  if (!iso?.trim()) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function resolveSubmitterName(report, profiles) {
  const profile = profiles.find((p) => p.userId === report.submittedByUserId);
  if (profile?.displayName?.trim()) return profile.displayName.trim();
  if (profile?.email) return profile.email.split('@')[0] ?? profile.email;
  return report.submittedByRole || '—';
}

function latestReviewIso(report, events) {
  const responses = report.responses ?? [];
  const responseTimes = responses.map((r) => r.approvedAt).filter((t) => t?.trim());

  const reviewEventTypes = new Set([
    'item_approved',
    'item_rejected',
    'item_correction',
    'report_finalized',
  ]);
  const eventTimes = events
    .filter((e) => e.reportId === report.id && reviewEventTypes.has(e.eventType))
    .map((e) => e.createdAt);

  const all = [...responseTimes, ...eventTimes].sort((a, b) => b.localeCompare(a));
  return all[0] ?? null;
}

function latestFeedbackNote(report, events) {
  const responses = report.responses ?? [];
  const flagged = responses.filter(
    (r) =>
      ['rejected', 'need_correction'].includes(r.status) && r.rejectionReason?.trim(),
  );
  if (flagged.length) {
    const sorted = [...flagged].sort((a, b) =>
      (b.updatedAt || b.approvedAt || '').localeCompare(a.updatedAt || a.approvedAt || ''),
    );
    return sorted[0].rejectionReason.trim();
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

export function computeCorrectionDurationMs(events, reportId) {
  const reportEvents = events
    .filter((e) => e.reportId === reportId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let maxGap = null;

  for (let i = 0; i < reportEvents.length; i++) {
    const ev = reportEvents[i];
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

function isWithinDateWindow(reportDate, daysBack) {
  if (!reportDate?.trim()) return false;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  return reportDate >= startStr && reportDate <= endStr;
}

function sortReports(a, b) {
  const orderA = STATUS_ORDER[a.status] ?? 99;
  const orderB = STATUS_ORDER[b.status] ?? 99;
  if (orderA !== orderB) return orderA - orderB;
  return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
}

function buildReportTimeline(report, events) {
  const reportEvents = events.filter((e) => e.reportId === report.id);
  const finalized = [...reportEvents]
    .reverse()
    .find((e) => e.eventType === 'report_finalized');

  const firstSubmitted = reportEvents.find((e) => e.eventType === 'submitted')
    ?? (report.submittedAt ? { createdAt: report.submittedAt } : null);

  const firstMs = firstSubmitted ? parseMs(firstSubmitted.createdAt) : null;
  const endMs = finalized ? parseMs(finalized.createdAt) : null;
  const totalDurationMs =
    firstMs != null && endMs != null ? endMs - firstMs : null;

  return {
    finalizedAt: finalized?.createdAt ?? null,
    totalDurationMs,
    source: reportEvents.length > 0 ? 'events' : 'inferred',
  };
}

export function buildReviewStatusRows(reports, profiles, events, options) {
  const { daysBack = 30, limit = 200, scope = 'current_list' } = options;

  let filtered = [...reports];

  if (scope === 'current_list') {
    filtered = filtered
      .filter((r) => isWithinDateWindow(r.reportDate, daysBack))
      .sort(sortReports)
      .slice(0, limit);
  }

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

export function computeDashboardKpis(reports) {
  if (!reports.length) {
    return {
      reportCount: 0,
      avgCompletion: 0,
      avgCompliance: 0,
      failedItemCount: 0,
    };
  }

  const completion = Math.round(
    reports.reduce((sum, r) => sum + (r.completionPercent ?? 0), 0) / reports.length,
  );
  const compliance = Math.round(
    reports.reduce((sum, r) => sum + (r.compliancePercent ?? 0), 0) / reports.length,
  );

  const failSet = new Set();
  for (const report of reports) {
    for (const resp of report.responses ?? []) {
      if (resp.status === 'rejected') failSet.add(resp.title);
    }
  }

  return {
    reportCount: reports.length,
    avgCompletion: completion,
    avgCompliance: compliance,
    failedItemCount: failSet.size,
  };
}
