import { Fragment, useMemo, useState } from 'react';
import { db } from '../db';
import ExportModal from './ExportModal';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildReportReviewStatusRows,
  buildReportReviewStatusSummary,
} from '../lib/reportReviewStatus';
import { formatDurationMs } from '../lib/reviewTimeline';
import { badgeClass } from '../lib/utils';
import ReportTimeline from './ReportTimeline';
import type { ExportFormat, Profile, Report, ReviewEvent } from '../types';

interface Props {
  profile: Profile;
}

export default function ReportReviewStatusPanel({ profile }: Props) {
  const { t } = useLang();
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const { data } = db.useQuery({
    reports: { responses: {} },
    reviewEvents: {},
    profiles: {},
  });

  const allEvents = (data?.reviewEvents ?? []) as ReviewEvent[];
  const profiles = (data?.profiles ?? []) as Profile[];
  const reports = data?.reports ?? [];

  const rows = useMemo(
    () =>
      buildReportReviewStatusRows(
        reports as Report[],
        profiles,
        allEvents,
        { profile },
      ),
    [reports, profiles, allEvents, profile],
  );

  const summary = useMemo(() => buildReportReviewStatusSummary(rows), [rows]);

  if (!rows.length) {
    return (
      <>
        <div className="card table-wrap report-review-status">
          <div className="dashboard-filters-header">
            <h2 style={{ margin: 0 }}>{t.reportReviewStatus.title}</h2>
            <button type="button" className="export-trigger-btn" onClick={() => setExportOpen(true)}>
              {t.export.exportTable}
            </button>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            {t.reportReviewStatus.noReports}
          </p>
        </div>
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          exportType="review_status"
          title={t.export.exportTable}
          showDaysBack
          defaultDaysBack={30}
          scopeOptions={[
            { value: 'current_list', label: t.export.scopeCurrentList },
            { value: 'all_assigned', label: t.export.scopeAllAssigned },
          ]}
          defaultScope="current_list"
          buildParams={(format: ExportFormat, scope: string, daysBack?: number) => ({
            exportType: 'review_status',
            format,
            scope,
            daysBack: daysBack ?? 30,
            limit: 200,
          })}
        />
      </>
    );
  }

  return (
    <>
    <div className="card table-wrap report-review-status">
      <div className="dashboard-filters-header">
        <h2 style={{ margin: 0 }}>{t.reportReviewStatus.title}</h2>
        <button type="button" className="export-trigger-btn" onClick={() => setExportOpen(true)}>
          {t.export.exportTable}
        </button>
      </div>

      <div className="report-review-status-chips">
        {summary.pending > 0 && (
          <span className="badge warn">
            {summary.pending} {t.reportReviewStatus.pending}
          </span>
        )}
        {summary.needCorrection > 0 && (
          <span className="badge warn">
            {summary.needCorrection} {t.reportReviewStatus.needCorrection}
          </span>
        )}
        {summary.rejected > 0 && (
          <span className="badge bad">
            {summary.rejected} {t.reportReviewStatus.rejected}
          </span>
        )}
        {summary.approved > 0 && (
          <span className="badge good">
            {summary.approved} {t.reportReviewStatus.approved}
          </span>
        )}
      </div>

      <table className="report-review-status-table">
        <thead>
          <tr>
            <th>{t.common.date}</th>
            <th>{t.common.store}</th>
            <th>{t.reportReviewStatus.submittedBy}</th>
            <th>{t.reportReviewStatus.submittedTime}</th>
            <th>{t.common.status}</th>
            <th>{t.reportReviewStatus.latestReview}</th>
            <th>{t.reportReviewStatus.latestFeedback}</th>
            <th>{t.reportReviewStatus.finalizedTime}</th>
            <th>{t.timeline.leadTime}</th>
            <th>{t.reportReviewStatus.correctionTime}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedReportId === row.report.id;
            const reportEvents = allEvents.filter((e) => e.reportId === row.report.id);

            return (
              <Fragment key={row.report.id}>
                <tr>
                  <td className="small">{row.reportDate}</td>
                  <td>
                    <strong>{row.storeCode}</strong>
                  </td>
                  <td className="small">{row.submittedBy}</td>
                  <td className="small report-review-status-nowrap">{row.submittedTime}</td>
                  <td>
                    <span className={badgeClass(row.status)}>{statusLabel(t, row.status)}</span>
                  </td>
                  <td className="small report-review-status-nowrap">{row.latestReviewTime}</td>
                  <td className="small report-review-status-feedback" title={row.latestFeedback}>
                    {row.latestFeedback || '—'}
                  </td>
                  <td className="small report-review-status-nowrap">{row.finalizedTime}</td>
                  <td className="small">
                    {row.leadTimeMs != null
                      ? formatDurationMs(row.leadTimeMs)
                      : t.timeline.pending}
                  </td>
                  <td className="small">
                    {row.correctionDurationMs != null
                      ? formatDurationMs(row.correctionDurationMs)
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="report-timeline-toggle"
                      onClick={() =>
                        setExpandedReportId((prev) =>
                          prev === row.report.id ? null : row.report.id,
                        )
                      }
                      aria-expanded={expanded}
                    >
                      {expanded ? t.reportReviewStatus.hideTimeline : t.reportReviewStatus.viewTimeline}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr key={`${row.report.id}-timeline`} className="report-review-status-expanded-row">
                    <td colSpan={11}>
                      <div className="report-review-status-expanded">
                        {row.timelineSource === 'inferred' && (
                          <p className="small report-timeline-partial">{t.timeline.partialHistory}</p>
                        )}
                        <ReportTimeline
                          report={row.report}
                          events={reportEvents}
                          defaultExpanded
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>

    <ExportModal
      open={exportOpen}
      onClose={() => setExportOpen(false)}
      exportType="review_status"
      title={t.export.exportTable}
      showDaysBack
      defaultDaysBack={30}
      scopeOptions={[
        { value: 'current_list', label: t.export.scopeCurrentList },
        { value: 'all_assigned', label: t.export.scopeAllAssigned },
      ]}
      defaultScope="current_list"
      buildParams={(format: ExportFormat, scope: string, daysBack?: number) => ({
        exportType: 'review_status',
        format,
        scope,
        daysBack: daysBack ?? 30,
        limit: 200,
      })}
    />
    </>
  );
}
