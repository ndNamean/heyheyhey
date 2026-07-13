/**
 * Flatten report/response data into CSV rows.
 */

function mediaStorageDeleted(mediaList) {
  if (!mediaList?.length) return false;
  return mediaList.every((m) => m.storageDeleted === true);
}

export function mapDashboardRows(reports, mediaByResponseId = {}) {
  const rows = [];

  for (const report of reports) {
    const responses = report.responses ?? [];
    if (!responses.length) {
      rows.push({
        report_id: report.id,
        report_date: report.reportDate,
        store_code: report.storeCode,
        store_name: report.storeName,
        template_name: report.templateName,
        report_status: report.status,
        completion_percent: report.completionPercent ?? 0,
        compliance_percent: report.compliancePercent ?? 0,
        item_section: '',
        item_title: '',
        item_status: '',
        feedback_code: '',
        feedback_note: '',
        approved_at: '',
        media_storage_deleted: '',
        submitted_by_role: report.submittedByRole ?? '',
      });
      continue;
    }

    for (const resp of responses) {
      const media = mediaByResponseId[resp.id] ?? [];
      rows.push({
        report_id: report.id,
        report_date: report.reportDate,
        store_code: report.storeCode,
        store_name: report.storeName,
        template_name: report.templateName,
        report_status: report.status,
        completion_percent: report.completionPercent ?? 0,
        compliance_percent: report.compliancePercent ?? 0,
        item_section: resp.section ?? '',
        item_title: resp.title ?? '',
        item_status: resp.status ?? '',
        feedback_code: resp.feedbackCode ?? '',
        feedback_note: resp.feedbackNote || resp.rejectionReason || '',
        approved_at: resp.approvedAt ?? '',
        media_storage_deleted: media.length ? mediaStorageDeleted(media) : '',
        submitted_by_role: report.submittedByRole ?? '',
      });
    }
  }

  return rows;
}

export const DASHBOARD_CSV_HEADERS = [
  'report_id',
  'report_date',
  'store_code',
  'store_name',
  'template_name',
  'report_status',
  'completion_percent',
  'compliance_percent',
  'item_section',
  'item_title',
  'item_status',
  'feedback_code',
  'feedback_note',
  'approved_at',
  'media_storage_deleted',
  'submitted_by_role',
];

export function mapReviewStatusRows(statusRows) {
  return statusRows.map((row) => ({
    report_date: row.reportDate,
    store_code: row.storeCode,
    submitted_by: row.submittedBy,
    submitted_time: row.submittedTime,
    status: row.status,
    latest_review_time: row.latestReviewTime,
    latest_feedback: row.latestFeedback,
    finalized_time: row.finalizedTime,
    lead_time_ms: row.leadTimeMs ?? '',
    correction_duration_ms: row.correctionDurationMs ?? '',
  }));
}

export const REVIEW_STATUS_CSV_HEADERS = [
  'report_date',
  'store_code',
  'submitted_by',
  'submitted_time',
  'status',
  'latest_review_time',
  'latest_feedback',
  'finalized_time',
  'lead_time_ms',
  'correction_duration_ms',
];

function msToMinutes(ms) {
  if (ms == null || ms < 0) return '';
  return Math.round(ms / 60000);
}

export function mapFailureHistoryRows(instances) {
  return instances.map((inst) => ({
    report_id: inst.reportId,
    report_date: inst.reportDate,
    store_code: inst.storeCode,
    template_name: inst.templateName,
    report_response_id: inst.reportResponseId,
    template_item_id: inst.templateItemId,
    item_title: inst.itemTitle,
    section: inst.section,
    category: inst.category,
    issue_type: inst.issueType,
    issue_at: inst.issueAt,
    issue_by_user_id: inst.issueByUserId,
    issue_by_name: inst.issueByName,
    issue_by_role: inst.issueByRole,
    rejection_reason: inst.rejectionReason,
    feedback_code: inst.feedbackCode,
    feedback_note: inst.feedbackNote,
    original_submitted_by_user_id: inst.originalSubmittedByUserId,
    original_submitted_by_role: inst.originalSubmittedByRole,
    original_submitted_at: inst.originalSubmittedAt,
    resubmitted_at: inst.resubmittedAt,
    resubmitted_by_user_id: inst.resubmittedByUserId,
    resubmitted_by_name: inst.resubmittedByName,
    resubmitted_by_role: inst.resubmittedByRole,
    correction_duration_minutes: msToMinutes(inst.correctionDurationMs),
    next_review_at: inst.nextReviewAt,
    next_review_by_user_id: inst.nextReviewByUserId,
    next_review_by_name: inst.nextReviewByName,
    next_review_by_role: inst.nextReviewByRole,
    next_review_decision: inst.nextReviewDecision,
    rereview_duration_minutes: msToMinutes(inst.rereviewDurationMs),
    final_approved_at: inst.finalApprovedAt,
    final_approved_by_user_id: inst.finalApprovedByUserId,
    final_approved_by_name: inst.finalApprovedByName,
    final_approved_by_role: inst.finalApprovedByRole,
    time_to_final_approval_minutes: msToMinutes(inst.timeToFinalApprovalMs),
    cycle_number: inst.cycleNumber,
    current_status: inst.currentStatus,
    report_final_status: inst.reportFinalStatus,
  }));
}

export const FAILURE_HISTORY_CSV_HEADERS = [
  'report_id',
  'report_date',
  'store_code',
  'template_name',
  'report_response_id',
  'template_item_id',
  'item_title',
  'section',
  'category',
  'issue_type',
  'issue_at',
  'issue_by_user_id',
  'issue_by_name',
  'issue_by_role',
  'rejection_reason',
  'feedback_code',
  'feedback_note',
  'original_submitted_by_user_id',
  'original_submitted_by_role',
  'original_submitted_at',
  'resubmitted_at',
  'resubmitted_by_user_id',
  'resubmitted_by_name',
  'resubmitted_by_role',
  'correction_duration_minutes',
  'next_review_at',
  'next_review_by_user_id',
  'next_review_by_name',
  'next_review_by_role',
  'next_review_decision',
  'rereview_duration_minutes',
  'final_approved_at',
  'final_approved_by_user_id',
  'final_approved_by_name',
  'final_approved_by_role',
  'time_to_final_approval_minutes',
  'cycle_number',
  'current_status',
  'report_final_status',
];
