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
