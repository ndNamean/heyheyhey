import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db';
import ExportModal from './ExportModal';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { statusLabel } from '../lib/i18nUtils';
import {
  REVIEW_STATUS_DAYS_BACK,
  REVIEW_STATUS_PAGE_SIZE,
  REVIEW_STATUS_PENDING_COUNT_LIMIT,
  REVIEW_STATUS_QUERY_LIMIT,
  buildReportReviewStatusListWhere,
  buildReportReviewStatusPendingWhere,
  buildReportReviewStatusRows,
  buildReportReviewStatusSummary,
  formatReviewStatusPendingBadge,
  type ReportReviewStatusMode,
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

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export default function ReportReviewStatusPanel({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [mode, setMode] = useState<ReportReviewStatusMode>('pending');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const lastGoodReportsRef = useRef<Report[]>([]);
  const lastGoodEventsRef = useRef<ReviewEvent[]>([]);
  const lastGoodProfilesRef = useRef<Profile[]>([]);
  const lastUserIdRef = useRef(profile.userId);
  const lastModeRef = useRef(mode);

  if (lastUserIdRef.current !== profile.userId) {
    lastUserIdRef.current = profile.userId;
    lastGoodReportsRef.current = [];
    lastGoodEventsRef.current = [];
    lastGoodProfilesRef.current = [];
  }
  if (lastModeRef.current !== mode) {
    lastModeRef.current = mode;
    lastGoodReportsRef.current = [];
    lastGoodEventsRef.current = [];
    lastGoodProfilesRef.current = [];
  }

  const storeIds = useMemo(
    () => (profile.stores ?? []).map((s) => s.id).filter(Boolean),
    [profile.stores],
  );
  const allStoresAccess = canAccessAllStores(profile.role, defs);
  const whereOpts = useMemo(
    () => ({
      canAccessAllStores: allStoresAccess,
      storeIds,
    }),
    [allStoresAccess, storeIds],
  );

  const listWhere = useMemo(
    () => buildReportReviewStatusListWhere(whereOpts, mode),
    [whereOpts, mode],
  );
  const pendingWhere = useMemo(
    () => buildReportReviewStatusPendingWhere(whereOpts),
    [whereOpts],
  );

  const infiniteQuery = useMemo(
    () =>
      listWhere === null
        ? null
        : {
            reports: {
              $: {
                where: listWhere,
                order: { submittedAt: 'desc' as const },
                limit: REVIEW_STATUS_PAGE_SIZE,
              },
              responses: {},
            },
          },
    [listWhere],
  );

  const pendingCountQuery = useMemo(
    () =>
      pendingWhere === null
        ? null
        : {
            reports: {
              $: {
                where: pendingWhere,
                order: { submittedAt: 'desc' as const },
                limit: REVIEW_STATUS_PENDING_COUNT_LIMIT,
              },
            },
          },
    [pendingWhere],
  );

  const {
    data: pageData,
    isLoading: listLoading,
    canLoadNextPage,
    loadNextPage,
    error: listError,
  } = db.useInfiniteQuery(
    (infiniteQuery ?? {
      reports: {
        $: {
          where: { id: '__review_status_skip__' },
          limit: 1,
        },
      },
    }) as Parameters<typeof db.useInfiniteQuery>[0],
  );

  const {
    data: pendingCountData,
    error: pendingCountError,
  } = db.useQuery(pendingCountQuery as Parameters<typeof db.useQuery>[0]);

  const queryReports = useMemo(() => {
    if (listWhere === null) return [] as Report[];
    return dedupeById((pageData?.reports ?? []) as Report[]);
  }, [listWhere, pageData?.reports]);

  if (queryReports.length && !listError) lastGoodReportsRef.current = queryReports;
  const reports =
    listWhere === null
      ? []
      : queryReports.length
        ? queryReports
        : lastGoodReportsRef.current;

  const exactPendingCount = pendingCountError
    ? null
    : ((pendingCountData?.reports ?? []) as Report[]).length;
  const pendingBadgeText =
    exactPendingCount == null
      ? null
      : formatReviewStatusPendingBadge(exactPendingCount);

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

  const loadedSummary = useMemo(() => buildReportReviewStatusSummary(rows), [rows]);

  useEffect(() => {
    setLoadMoreError(false);
    setExpandedReportId(null);
  }, [profile.userId, mode]);

  async function handleLoadMore() {
    if (!canLoadNextPage || isLoadingMore || typeof loadNextPage !== 'function') return;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      await Promise.resolve(loadNextPage());
    } catch {
      setLoadMoreError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }

  const waitingForReports =
    listWhere !== null &&
    !rows.length &&
    (listLoading || (pageData == null && !listError));
  const loadFailed = Boolean(listError) && !rows.length && listWhere !== null;

  const header = (
    <div className="dashboard-filters-header report-review-status-header">
      <div className="report-review-status-heading">
        <h2 style={{ margin: 0 }}>{t.reportReviewStatus.title}</h2>
        {pendingBadgeText != null && exactPendingCount != null && exactPendingCount > 0 && (
          <span className="badge warn">
            {pendingBadgeText} {t.reportReviewStatus.pending}
          </span>
        )}
      </div>
      <div className="report-review-status-header-actions">
        <span
          className="feedback-inbox-mode"
          role="group"
          aria-label={t.reportReviewStatus.modeLabel}
        >
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'pending' ? ' is-active' : ''}`}
            aria-pressed={mode === 'pending'}
            onClick={() => setMode('pending')}
          >
            {t.reportReviewStatus.pendingOnly}
          </button>
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'all' ? ' is-active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            {t.reportReviewStatus.showAll}
          </button>
        </span>
        <button type="button" className="export-trigger-btn" onClick={() => setExportOpen(true)}>
          {t.export.exportTable}
        </button>
      </div>
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

  const statusChips =
    mode === 'all' && rows.length ? (
      <div className="report-review-status-chips">
        {loadedSummary.needCorrection > 0 && (
          <span className="badge warn">
            {loadedSummary.needCorrection} {t.reportReviewStatus.needCorrection}
          </span>
        )}
        {loadedSummary.rejected > 0 && (
          <span className="badge bad">
            {loadedSummary.rejected} {t.reportReviewStatus.rejected}
          </span>
        )}
        {loadedSummary.approved > 0 && (
          <span className="badge good">
            {loadedSummary.approved} {t.reportReviewStatus.approved}
          </span>
        )}
      </div>
    ) : null;

  let body: ReactNode;
  if (rows.length) {
    body = (
      <>
        {statusChips}
        <div className="report-review-status-scroll">
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
                          {expanded
                            ? t.reportReviewStatus.hideTimeline
                            : t.reportReviewStatus.viewTimeline}
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
        {(canLoadNextPage || loadMoreError) && listWhere !== null && (
          <div className="feedback-load-more-wrap">
            {loadMoreError && (
              <div className="feedback-list-status">{t.reportReviewStatus.loadMoreError}</div>
            )}
            <button
              type="button"
              className="feedback-load-more"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? `${t.reportReviewStatus.loadMore}...`
                : loadMoreError
                  ? t.reportReviewStatus.retry
                  : t.reportReviewStatus.loadMore}
            </button>
          </div>
        )}
      </>
    );
  } else if (loadFailed) {
    body = (
      <div style={{ marginTop: 8 }}>
        <p className="small">{t.reportReviewStatus.loadError}</p>
        <button
          type="button"
          className="feedback-inbox-action"
          onClick={() => window.location.reload()}
        >
          {t.reportReviewStatus.retry}
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
        {mode === 'pending'
          ? t.reportReviewStatus.noPending
          : t.reportReviewStatus.noReports}
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
