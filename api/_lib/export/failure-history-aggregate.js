/**
 * Server-side failure history aggregation for CSV export.
 * Mirrors src/lib/failureCorrectionHistory.ts issue instance building.
 */

const DECISION_TYPES = new Set(['item_approved', 'item_rejected', 'item_correction']);
const ISSUE_TYPES = new Set(['item_rejected', 'item_correction']);

function parseMs(iso) {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dateInRange(iso, from, to) {
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

function actorName(userId, snapshot, profiles) {
  if (snapshot?.trim()) return snapshot.trim();
  const p = profiles.find((x) => x.userId === userId);
  if (p?.displayName?.trim()) return p.displayName.trim();
  if (p?.email) return p.email.split('@')[0] ?? p.email;
  if (userId) return `Former user — ${userId.slice(0, 8)}`;
  return 'Unknown';
}

function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.reportResponseId}|${e.eventType}|${e.createdAt}|${e.actorUserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function buildIssueInstancesForExport(events, reports, profiles) {
  const responsesById = new Map();
  for (const report of reports) {
    for (const resp of report.responses ?? []) {
      responsesById.set(resp.id, { ...resp, report });
    }
  }

  const reportById = new Map(reports.map((r) => [r.id, r]));
  const sorted = dedupeEvents([...events]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const instances = [];
  const issueCountByResponse = new Map();

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
      resubmittedAt: resubmit?.createdAt ?? '',
      resubmittedByUserId: resubmit?.actorUserId ?? '',
      resubmittedByRole: resubmit?.actorRole ?? '',
      resubmittedByName: resubmit
        ? actorName(resubmit.actorUserId, resubmit.actorDisplayNameSnapshot, profiles)
        : '',
      correctionDurationMs:
        issueMs != null && resubmitMs != null ? resubmitMs - issueMs : null,
      nextReviewAt: nextDecision?.createdAt ?? '',
      nextReviewByUserId: nextDecision?.actorUserId ?? '',
      nextReviewByRole: nextDecision?.actorRole ?? '',
      nextReviewByName: nextDecision
        ? actorName(nextDecision.actorUserId, nextDecision.actorDisplayNameSnapshot, profiles)
        : '',
      nextReviewDecision: nextDecision?.statusAfter ?? '',
      rereviewDurationMs:
        resubmitMs != null && nextDecisionMs != null ? nextDecisionMs - resubmitMs : null,
      finalApprovedAt: finalApproval?.createdAt ?? '',
      finalApprovedByUserId: finalApproval?.actorUserId ?? '',
      finalApprovedByRole: finalApproval?.actorRole ?? '',
      finalApprovedByName: finalApproval
        ? actorName(finalApproval.actorUserId, finalApproval.actorDisplayNameSnapshot, profiles)
        : '',
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
      originalSubmittedAt: firstSubmit?.createdAt ?? respMeta?.submittedAt ?? report?.submittedAt ?? '',
    });
  }

  return instances;
}

export function filterIssueInstances(instances, filters) {
  return instances.filter((inst) => {
    if (!dateInRange(inst.issueAt, filters.startDate, filters.endDate)) return false;
    if (filters.storeIds?.length && !filters.storeIds.includes(inst.storeId)) return false;
    return true;
  });
}
