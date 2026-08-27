import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db';
import ExportModal from './ExportModal';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { statusLabel } from '../lib/i18nUtils';
import {
  REVIEW_STATUS_DAYS_BACK,
  REVIEW_STATUS_QUERY_LIMIT,
  buildReportReviewStatusRows,
  buildReportReviewStatusSummary,
  buildReportReviewStatusWhere,
} from '../lib/reportReviewStatus';
import { canAccessAllStores } from '../lib/roles';
import { formatDurationMs } from '../lib/reviewTimeline';
import { badgeClass } from '../lib/utils';
import ReportTimeline from './ReportTimeline';
import IdentityWithAvatar from './profileAvatar/IdentityWithAvatar';
import type { ExportFormat, Profile, Report, ReviewEvent } from '../types';

interface Props {
  profile: Profile;
}

export default function ReportReviewStatusPanel({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [queryPaused, setQueryPaused] = useState(false);
  const lastGoodReportsRef = useRef<Report[]>([]);
  const lastGoodEventsRef = useRef<ReviewEvent[]>([]);
  const lastGoodProfilesRef = useRef<Profile[]>([]);
  const lastUserIdRef = useRef(profile.userId);

  if (lastUserIdRef.current !== profile.userId) {
    lastUserIdRef.current = profile.userId;
    lastGoodReportsRef.current = [];
    lastGoodEventsRef.current = [];
    lastGoodProfilesRef.current = [];
  }

  useEffect(() => {
    if (!queryPaused) return;
    setQueryPaused(false);
  }, [queryPaused]);

  const storeIds = useMemo(
    () => (profile.stores ?? []).map((s) => s.id).filter(Boolean),
    [profile.stores],
  );
  const allStoresAccess = canAccessAllStores(profile.role, defs);
  const reportsWhere = useMemo(
    () =>
      buildReportReviewStatusWhere({
        canAccessAllStores: allStoresAccess,
        storeIds,
      }),
    [allStoresAccess, storeIds],
  );

  const reportsQuery = useMemo(
    () =>
      queryPaused || reportsWhere === null
        ? null
        : {
            reports: {
              $: {
                where: reportsWhere,
                order: { submittedAt: 'desc' as const },
                limit: REVIEW_STATUS_QUERY_LIMIT,
              },
              responses: {},
            },
          },
    [queryPaused, reportsWhere],
  );

  const {
    data: reportsData,
    isLoading: reportsLoading,
    error: reportsError,
  } = db.useQuery(reportsQuery as Parameters<typeof db.useQuery>[0]);

  const queryReports = (reportsData?.reports ?? []) as Report[];
  if (queryReports.length && !reportsError) lastGoodReportsRef.current = queryReports;
  const reports = queryReports.length ? queryReports : lastGoodReportsRef.current;

  const followupReportIds = useMemo(
    () => reports.map((r) => r.id).filter(Boolean),
    [reports],
  );

  const submitterIds = useMemo(
    () => [...new Set(reports.map((r) => r.submittedByUserId).filter(Boolean))],
    [reports],
  );

  const eventsQuery = useMemo(() => {
    if (!followupReportIds.length) return null;
    return {
      reviewEvents: {
        $: { where: { reportId: { $in: followupReportIds } } },
      },
    };
  }, [followupReportIds]);

  const profilesQuery = useMemo(() => {
    if (!submitterIds.length) return null;
    return {
      profiles: {
        $: { where: { userId: { $in: submitterIds } } },
        avatarFile: {},
      },
    };
  }, [submitterIds]);

  const { data: eventsData } = db.useQuery(
    eventsQuery as Parameters<typeof db.useQuery>[0],
  );
  const { data: profilesData } = db.useQuery(
    profilesQuery as Parameters<typeof db.useQuery>[0],
  );

  const queryEvents = (eventsData?.reviewEvents ?? []) as ReviewEvent[];
  const queryProfiles = (profilesData?.profiles ?? []) as Profile[];
  if (queryEvents.length) lastGoodEventsRef.current = queryEvents;
  if (queryProfiles.length) lastGoodProfilesRef.current = queryProfiles;
  const allEvents = queryEvents.length ? queryEvents : lastGoodEventsRef.current;
  const profiles = queryProfiles.length ? queryProfiles : lastGoodProfilesRef.current;

  const rows = useMemo(
    () =>
      buildReportReviewStatusRows(reports, profiles, allEvents, { profile, defs }),
    [reports, profiles, allEvents, profile, defs],
  );

  const summary = useMemo(() => buildReportReviewStatusSummary(rows), [rows]);

  const waitingForReports =
    Boolean(reportsQuery) &&
    !rows.length &&
    (reportsLoading || (reportsData == null && !reportsError));
  const loadFailed = Boolean(reportsError) && !rows.length;

  const header = (
    <div className="dashboard-filters-header">
      <h2 style={{ margin: 0 }}>{t.reportReviewStatus.title}</h2>
      <button type="button" className="export-trigger-btn" onClick={() => setExportOpen(true)}>
        {t.export.exportTable}
      </button>
    </div>
  );

  const exportModal = (
    <ExportModal
      open={exportOpen}
      onClose={() => setExportOpen(false)}
      exportType="review_status"
      title={t.export.exportTable}
      showDaysBack
      defaultDaysBack={REVIEW_STATUS_DAYS_BACK}
      scopeOptions={[
        { value: 'current_list', label: t.export.scopeCurrentList },
        { value: 'all_assigned', label: t.export.scopeAllAssigned },
      ]}
      defaultScope="current_list"
      buildParams={(format: ExportFormat, scope: string, daysBack?: number) => ({
        exportType: 'review_status',
        format,
        scope,
        daysBack: daysBack ?? REVIEW_STATUS_DAYS_BACK,
        limit: REVIEW_STATUS_QUERY_LIMIT,
      })}
    />
  );

  let body: ReactNode;
  if (rows.length) {
    body = (
      <>
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
              const submitterProfile = profiles.find(
                (p) => p.userId === row.report.submittedByUserId,
              );

              return (
                <Fragment key={row.report.id}>
                  <tr>
                    <td className="small">{row.reportDate}</td>
                    <td>
                      <strong>{row.storeCode}</strong>
                    </td>
                    <td className="small">
                      <IdentityWithAvatar profile={submitterProfile}>
                        {row.submittedBy}
                      </IdentityWithAvatar>
                    </td>
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
      </>
    );
  } else if (loadFailed) {
    body = (
      <div style={{ marginTop: 8 }}>
        <p className="small">{t.common.error}</p>
        <button type="button" className="secondary" onClick={() => setQueryPaused(true)}>
          {t.common.retry}
        </button>
      </div>
    );
  } else if (waitingForReports) {
    body = (
      <p className="small" style={{ marginTop: 8 }}>
        {t.common.loading}
      </p>
    );
  } else {
    body = (
      <p className="small" style={{ marginTop: 8 }}>
        {t.reportReviewStatus.noReports}
      </p>
    );
  }

  return (
    <>
      <div className="card table-wrap report-review-status">
        {header}
        {body}
      </div>
      {exportModal}
    </>
  );
}
