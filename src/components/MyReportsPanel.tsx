import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { badgeClass } from '../lib/utils';
import {
  MY_REPORTS_PAGE_SIZE,
  reconcileOwnReportNeedsActionCount,
} from '../lib/reportNeedsAction';
import { useReportNeedsActionCount } from '../hooks/useReportNeedsActionCount';
import ReportTimeline from './ReportTimeline';
import type { Profile, Report, ReportResponse, ReviewEvent } from '../types';

type InboxMode = 'needs_action' | 'all';

interface Props {
  profile: Profile;
  onFixReport?: (reportId: string) => void;
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

export default function MyReportsPanel({ profile, onFixReport }: Props) {
  const { t } = useLang();
  const [mode, setMode] = useState<InboxMode>('needs_action');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const reconciledRef = useRef(false);

  const { needsActionCount, row: needsActionRow } = useReportNeedsActionCount(profile.userId);

  const infiniteQuery = useMemo(
    () => ({
      reports: {
        $: {
          where:
            mode === 'needs_action'
              ? { submittedByUserId: profile.userId, submitterNeedsAction: true }
              : { submittedByUserId: profile.userId },
          order: { submittedAt: 'desc' as const },
          limit: MY_REPORTS_PAGE_SIZE,
        },
        responses: {},
      },
    }),
    [mode, profile.userId],
  );

  const {
    data: pageData,
    isLoading: listLoading,
    canLoadNextPage,
    loadNextPage,
    error: listError,
  } = db.useInfiniteQuery(infiniteQuery);

  const reports = useMemo(
    () => dedupeById((pageData?.reports ?? []) as Report[]),
    [pageData?.reports],
  );

  const loadedReportIds = useMemo(() => reports.map((r) => r.id), [reports]);

  const eventsQuery = useMemo(() => {
    if (!loadedReportIds.length) return null;
    return {
      reviewEvents: {
        $: { where: { reportId: { $in: loadedReportIds } } },
      },
    };
  }, [loadedReportIds]);

  const { data: eventsData } = db.useQuery(
    eventsQuery as Parameters<typeof db.useQuery>[0],
  );

  const allEvents = (eventsData?.reviewEvents ?? []) as ReviewEvent[];

  const eventsByReportId = useMemo(() => {
    const map = new Map<string, ReviewEvent[]>();
    for (const e of allEvents) {
      if (!e.reportId) continue;
      const list = map.get(e.reportId) ?? [];
      list.push(e);
      map.set(e.reportId, list);
    }
    return map;
  }, [allEvents]);

  useEffect(() => {
    setLoadMoreError(false);
  }, [profile.userId, mode]);

  useEffect(() => {
    if (!profile.userId || reconciledRef.current) return;
    if (needsActionRow) {
      reconciledRef.current = true;
      return;
    }
    reconciledRef.current = true;
    void reconcileOwnReportNeedsActionCount();
  }, [profile.userId, needsActionRow]);

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

  const header = (
    <div className="feedback-inbox-header">
      <div className="feedback-inbox-heading">
        <h2 style={{ margin: 0 }}>{t.staffHome.myReports}</h2>
        {needsActionCount > 0 && (
          <span className="badge bad">
            {needsActionCount} {t.staffHome.needAction}
          </span>
        )}
      </div>
      <div className="feedback-inbox-actions">
        <span className="feedback-inbox-mode" role="group" aria-label={t.staffHome.myReportsModeLabel}>
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'needs_action' ? ' is-active' : ''}`}
            aria-pressed={mode === 'needs_action'}
            onClick={() => setMode('needs_action')}
          >
            {t.staffHome.needsActionOnly}
          </button>
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'all' ? ' is-active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            {t.staffHome.showAll}
          </button>
        </span>
      </div>
    </div>
  );

  const listBody = (() => {
    if (listLoading && !reports.length) {
      return <div className="feedback-list-status">{t.staffHome.myReportsLoading}</div>;
    }
    if (listError && !reports.length) {
      return (
        <div className="feedback-list-status">
          {t.staffHome.myReportsLoadError}{' '}
          <button
            type="button"
            className="feedback-inbox-action"
            onClick={() => window.location.reload()}
          >
            {t.staffHome.myReportsRetry}
          </button>
        </div>
      );
    }
    if (!reports.length) {
      return (
        <div className="feedback-list-status">
          {mode === 'needs_action'
            ? t.staffHome.myReportsEmptyNeedsAction
            : t.staffHome.myReportsEmptyAll}
        </div>
      );
    }

    return (
      <>
        <div className="feedback-list-status">
          {t.staffHome.myReportsShowing.replace('{shown}', String(reports.length))}
        </div>
        {reports.map((report) => {
          const responses = (report.responses ?? []) as ReportResponse[];
          const flagged = responses.filter((r) =>
            ['rejected', 'need_correction'].includes(r.status),
          );

          return (
            <div className="item-card" key={report.id} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, flex: 1 }}>
                  {report.storeCode} — {report.templateName}
                </h3>
                <span className={badgeClass(report.status)}>{statusLabel(t, report.status)}</span>
              </div>
              <p className="small" style={{ margin: '6px 0 0' }}>
                {report.reportDate} · {t.feedback.completion} {report.completionPercent ?? 0}% ·{' '}
                {t.feedback.compliance} {report.compliancePercent ?? 0}%
              </p>

              {flagged.map((resp) => (
                <div className="feedback-report-item" key={resp.id}>
                  <strong>{resp.title}</strong>
                  <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                  {resp.rejectionReason && (
                    <p className="feedback-report-reason">{resp.rejectionReason}</p>
                  )}
                </div>
              ))}

              {flagged.length > 0 && onFixReport && (
                <button
                  className="fix-resubmit-btn"
                  style={{ marginTop: 10 }}
                  onClick={() => onFixReport(report.id)}
                >
                  {t.staffHome.fixResubmit} ({flagged.length}{' '}
                  {flagged.length > 1 ? t.staffHome.items : t.staffHome.item})
                </button>
              )}

              <ReportTimeline
                report={report}
                events={eventsByReportId.get(report.id) ?? []}
                compact
              />
            </div>
          );
        })}
        {(canLoadNextPage || loadMoreError) && (
          <div className="feedback-load-more-wrap">
            {loadMoreError && (
              <div className="feedback-list-status">{t.staffHome.myReportsLoadMoreError}</div>
            )}
            <button
              type="button"
              className="feedback-load-more"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? `${t.staffHome.myReportsLoadMore}...`
                : loadMoreError
                  ? t.staffHome.myReportsRetry
                  : t.staffHome.myReportsLoadMore}
            </button>
          </div>
        )}
      </>
    );
  })();

  return (
    <div className="card feedback-inbox">
      {header}
      <div className="feedback-list">{listBody}</div>
    </div>
  );
}
