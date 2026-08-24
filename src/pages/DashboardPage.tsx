import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { db } from '../db';
import FeedbackInbox from '../components/FeedbackInbox';
import LogbookNotificationPreviewModal, {
  decideLogbookNotificationClick,
} from '../components/LogbookNotificationPreviewModal';
import {
  filterForLogbookNotificationOpen,
  shouldAutoOpenLogbookResolutionForViewer,
} from '../lib/logbookNotificationContent';
import ExportModal from '../components/ExportModal';
import FailureCorrectionHistory from '../components/FailureCorrectionHistory';
import DashboardContextStack from '../components/DashboardContextStack';
import DashboardStickyTableHeader from '../components/DashboardStickyTableHeader';
import ScheduledTaskCompletion from '../components/ScheduledTaskCompletion';
import { ReportTimelineLeadCell } from '../components/ReportTimeline';
import IdentityWithAvatar from '../components/profileAvatar/IdentityWithAvatar';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { aggregateFeedbackFrequency } from '../lib/feedbackReasons';
import { isFailureHistoryEnabled } from '../lib/failureHistoryFlag';
import { badgeClass, todayYmd } from '../lib/utils';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canAccessAllStores, canAccessChecklistItemProposals } from '../lib/roles';
import {
  computeChecklistItemProposalMetrics,
  filterProposalsForViewer,
} from '../lib/checklistItemProposals';
import {
  canReviewLogbookIssue,
  canViewLogbookEntry,
  isIssueOverdue,
  resolveLogbookIssueStatus,
} from '../lib/logbook';
import {
  computeLogbookIssueMetrics,
  filterLogbookIssues,
  formatDurationMs,
  overdueDurationMs,
} from '../lib/logbookMetrics';
import { maybeNotifyLogbookDueStates } from '../lib/logbookDueNotify';
import type {
  ChecklistItemProposal,
  ExportFormat,
  LogbookEntry,
  Profile,
  Report,
  ReportResponse,
  ReviewEvent,
  Store,
  Template,
} from '../types';

interface Props {
  profile: Profile;
  onOpenProposals?: () => void;
  onOpenLogbook?: (filter?: string) => void;
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function DashboardPage({ profile, onOpenProposals, onOpenLogbook }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(todayYmd);
  const [filterStoreId, setFilterStoreId] = useState('all');
  const [showOtherDetails, setShowOtherDetails] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [failureExportOpen, setFailureExportOpen] = useState(false);
  const [issueStatusFilter, setIssueStatusFilter] = useState('all');
  const [issueSeverityFilter, setIssueSeverityFilter] = useState('all');
  const [issueAssigneeFilter, setIssueAssigneeFilter] = useState('all');
  const [issueOverdueOnly, setIssueOverdueOnly] = useState(false);
  const [issueWaitingMyReview, setIssueWaitingMyReview] = useState(false);
  const [logbookPreview, setLogbookPreview] = useState<{
    entryId: string;
    type?: string;
    deepLinkFilter?: string;
  } | null>(null);
  const dueNotifyRan = useRef(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const logbookTableScrollerRef = useRef<HTMLDivElement | null>(null);
  const logbookTableRef = useRef<HTMLTableElement | null>(null);
  const failedItemsTableScrollerRef = useRef<HTMLDivElement | null>(null);
  const failedItemsTableRef = useRef<HTMLTableElement | null>(null);
  const proposalsTableScrollerRef = useRef<HTMLDivElement | null>(null);
  const proposalsTableRef = useRef<HTMLTableElement | null>(null);
  const feedbackTableScrollerRef = useRef<HTMLDivElement | null>(null);
  const feedbackTableRef = useRef<HTMLTableElement | null>(null);
  const recentReportsTableScrollerRef = useRef<HTMLDivElement | null>(null);
  const recentReportsTableRef = useRef<HTMLTableElement | null>(null);
  const [holdDashLive, setHoldDashLive] = useState(false);
  const lastGoodDashRef = useRef<{ reports: Report[]; stores: Store[] } | null>(null);
  const lastGoodProfilesRef = useRef<Profile[]>([]);
  const lastGoodEventsRef = useRef<ReviewEvent[]>([]);
  const lastGoodTemplatesRef = useRef<Template[]>([]);
  const lastGoodProposalsRef = useRef<ChecklistItemProposal[]>([]);
  const lastGoodLogbookRef = useRef<LogbookEntry[]>([]);

  const reportsQuery = useMemo(
    () =>
      holdDashLive
        ? null
        : {
            reports: {
              responses: {},
              store: {},
            },
            stores: {},
          },
    [holdDashLive],
  );
  const profilesQuery = useMemo(() => ({ profiles: { stores: {} } }), []);
  const eventsQuery = useMemo(
    () => (holdDashLive ? { reviewEvents: {} } : null),
    [holdDashLive],
  );
  const templatesQuery = useMemo(
    () =>
      holdDashLive
        ? { templates: { items: {}, stores: {}, scheduleVersions: {} } }
        : null,
    [holdDashLive],
  );
  const proposalsQuery = useMemo(
    () => (holdDashLive ? { checklistItemProposals: {} } : null),
    [holdDashLive],
  );
  const logbookQuery = useMemo(
    () => (holdDashLive ? { logbookEntries: { store: {} } } : null),
    [holdDashLive],
  );

  const {
    data: reportsData,
    isLoading: reportsLoading,
    error: reportsError,
  } = db.useQuery(reportsQuery);
  useEffect(() => {
    if (reportsData && !reportsError) setHoldDashLive(true);
  }, [reportsData, reportsError]);
  const { data: profilesData } = db.useQuery(profilesQuery);
  const { data: eventsData } = db.useQuery(eventsQuery);
  const { data: templatesData } = db.useQuery(templatesQuery);
  const { data: proposalsData } = db.useQuery(proposalsQuery);
  const { data: logbookData } = db.useQuery(logbookQuery);

  const queryReports = (reportsData?.reports ?? []) as Report[];
  const queryStores = (reportsData?.stores ?? []) as Store[];
  if ((queryReports.length || queryStores.length) && !reportsError) {
    lastGoodDashRef.current = { reports: queryReports, stores: queryStores };
  }
  const queryProfiles = (profilesData?.profiles ?? []) as Profile[];
  if (queryProfiles.length) lastGoodProfilesRef.current = queryProfiles;
  const queryEvents = (eventsData?.reviewEvents ?? []) as ReviewEvent[];
  if (queryEvents.length) lastGoodEventsRef.current = queryEvents;
  const queryTemplates = (templatesData?.templates ?? []) as Template[];
  if (queryTemplates.length) lastGoodTemplatesRef.current = queryTemplates;
  const queryProposals = (proposalsData?.checklistItemProposals ?? []) as ChecklistItemProposal[];
  if (queryProposals.length) lastGoodProposalsRef.current = queryProposals;
  const queryLogbook = (logbookData?.logbookEntries ?? []) as LogbookEntry[];
  if (queryLogbook.length) lastGoodLogbookRef.current = queryLogbook;

  const allReports: Report[] = queryReports.length
    ? queryReports
    : (lastGoodDashRef.current?.reports ?? []);
  const stores = queryStores.length ? queryStores : (lastGoodDashRef.current?.stores ?? []);
  const profiles = queryProfiles.length ? queryProfiles : lastGoodProfilesRef.current;
  const allEvents = queryEvents.length ? queryEvents : lastGoodEventsRef.current;
  const allTemplates: Template[] = queryTemplates.length
    ? queryTemplates
    : lastGoodTemplatesRef.current;
  const allProposals = queryProposals.length ? queryProposals : lastGoodProposalsRef.current;
  const allLogbookEntries = queryLogbook.length ? queryLogbook : lastGoodLogbookRef.current;

  const reports = useMemo(() => {
    let filtered = allReports.filter((r) => r.reportDate >= from && r.reportDate <= to);

    // Scope to accessible stores for non-owner users
    if (!canAccessAllStores(profile.role, defs)) {
      const accessibleIds = new Set((profile.stores ?? []).map((s) => s.id));
      filtered = filtered.filter((r) => accessibleIds.has(r.storeId));
    }

    if (filterStoreId !== 'all') {
      filtered = filtered.filter((r) => r.storeId === filterStoreId);
    }

    return filtered;
  }, [allReports, profile, filterStoreId, defs, from, to]);

  const historyReports = useMemo(() => {
    let filtered = allReports;
    if (!canAccessAllStores(profile.role, defs)) {
      const accessibleIds = new Set((profile.stores ?? []).map((s) => s.id));
      filtered = filtered.filter((r) => accessibleIds.has(r.storeId));
    }
    if (filterStoreId !== 'all') {
      filtered = filtered.filter((r) => r.storeId === filterStoreId);
    }
    return filtered;
  }, [allReports, profile, filterStoreId, defs]);

  const historyStoreIds = useMemo(() => {
    if (filterStoreId !== 'all') return [filterStoreId];
    if (canAccessAllStores(profile.role, defs)) return null;
    return (profile.stores ?? []).map((s) => s.id);
  }, [filterStoreId, profile, defs]);

  const metrics = useMemo(() => {
    if (!reports.length) return { completion: 0, compliance: 0, reportCount: 0, failed: [] };

    const completion = Math.round(
      reports.reduce((sum, r) => sum + (r.completionPercent ?? 0), 0) / reports.length,
    );
    const compliance = Math.round(
      reports.reduce((sum, r) => sum + (r.compliancePercent ?? 0), 0) / reports.length,
    );

    // Aggregate failed items across all report responses
    const failMap: Record<string, { title: string; section: string; failureCategory: string; count: number }> =
      {};
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

    return {
      completion,
      compliance,
      reportCount: reports.length,
      failed: Object.values(failMap).sort((a, b) => b.count - a.count),
    };
  }, [reports]);

  // Approval share by role
  const approvalShare = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const report of reports) {
      for (const resp of (report.responses ?? []) as ReportResponse[]) {
        if (resp.status === 'approved' && resp.approvedByUserId) {
          const approver = (profiles as Profile[]).find((p) => p.userId === resp.approvedByUserId);
          const role = approver?.role ?? 'unknown';
          counts[role] = (counts[role] ?? 0) + 1;
        }
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts).map(([role, count]) => ({
      role,
      count,
      percent: total ? Math.round((count / total) * 100) : 0,
    }));
  }, [reports, profiles]);

  const feedbackStats = useMemo(
    () => aggregateFeedbackFrequency(reports, profiles as Profile[]),
    [reports, profiles],
  );

  const proposalMetrics = useMemo(() => {
    const scoped = filterProposalsForViewer(allProposals, profile, defs).filter((p) => {
      const day = (p.createdAt || '').slice(0, 10);
      if (day && (day < from || day > to)) return false;
      if (filterStoreId !== 'all') {
        return (
          p.sourceStoreId === filterStoreId ||
          p.requesterStoreId === filterStoreId ||
          (p.affectedStoreIdsJson || '').includes(filterStoreId)
        );
      }
      return true;
    });
    return { list: scoped, metrics: computeChecklistItemProposalMetrics(scoped) };
  }, [allProposals, profile, defs, from, to, filterStoreId]);

  const logbookIssuesScoped = useMemo(() => {
    const visible = allLogbookEntries.filter((e) => canViewLogbookEntry(profile, e, defs));
    return filterLogbookIssues(visible, {
      storeId: filterStoreId,
      fromYmd: from,
      toYmd: to,
    });
  }, [allLogbookEntries, profile, defs, filterStoreId, from, to]);

  const logbookMetrics = useMemo(
    () => computeLogbookIssueMetrics(logbookIssuesScoped),
    [logbookIssuesScoped],
  );

  const logbookIssueRows = useMemo(() => {
    const now = Date.now();
    return logbookIssuesScoped.filter((e) => {
      const status = resolveLogbookIssueStatus(e);
      if (issueStatusFilter !== 'all' && status !== issueStatusFilter) return false;
      if (issueSeverityFilter !== 'all' && e.severity !== issueSeverityFilter) return false;
      if (issueAssigneeFilter !== 'all' && (e.assigneeRole || '') !== issueAssigneeFilter) {
        return false;
      }
      if (issueOverdueOnly && !isIssueOverdue(e, now)) return false;
      if (
        issueWaitingMyReview &&
        (status !== 'waiting_approval' || !canReviewLogbookIssue(profile, e, defs))
      ) {
        return false;
      }
      return true;
    });
  }, [
    logbookIssuesScoped,
    issueStatusFilter,
    issueSeverityFilter,
    issueAssigneeFilter,
    issueOverdueOnly,
    issueWaitingMyReview,
    profile,
    defs,
  ]);

  const logbookHeaderLabels = useMemo(
    () => [
      t.logbook.typeIssue,
      t.common.store,
      t.common.severity,
      t.logbook.assigneeRole,
      t.logbook.dueAt,
      t.common.status,
      t.logbook.overdueDuration,
      t.common.actions,
    ],
    [t],
  );

  const failedItemsHeaderLabels = useMemo(
    () => [t.dashboard.item, t.common.section, t.dashboard.category, t.dashboard.times],
    [t],
  );

  const proposalsHeaderLabels = useMemo(
    () => [
      t.checklistProposals.itemTitle,
      t.checklistProposals.section,
      t.checklistProposals.targetTemplate,
      t.checklistProposals.requester,
      t.checklistProposals.requesterRole,
      t.common.status,
    ],
    [t],
  );

  const feedbackHeaderLabels = useMemo(
    () => [
      t.review.feedbackReason,
      t.dashboard.count,
      t.dashboard.share,
      t.dashboard.feedbackFreq,
    ],
    [t],
  );

  const recentReportsHeaderLabels = useMemo(
    () => [
      t.common.store,
      t.common.template,
      t.common.date,
      t.common.status,
      t.dashboard.completion,
      t.dashboard.leadTime,
    ],
    [t],
  );

  useEffect(() => {
    if (dueNotifyRan.current || !allLogbookEntries.length) return;
    dueNotifyRan.current = true;
    const visible = allLogbookEntries.filter((e) => canViewLogbookEntry(profile, e, defs));
    void maybeNotifyLogbookDueStates(visible, profile, profiles as Profile[], defs).then((ok) => {
      if (!ok) dueNotifyRan.current = false;
    });
  }, [allLogbookEntries, profile, profiles, defs]);

  const displayStores = canAccessAllStores(profile.role, defs)
    ? stores
    : (profile.stores ?? []);

  const previewEntry = logbookPreview
    ? allLogbookEntries.find((e) => e.id === logbookPreview.entryId) ?? null
    : null;

  function navigateToLogbookEntry(
    entryId: string,
    type: string | undefined,
    deepLinkFilter: string | undefined,
    entry: LogbookEntry | undefined,
  ) {
    const filter = filterForLogbookNotificationOpen(
      type || '',
      profile,
      entry,
      defs,
      deepLinkFilter,
    );
    try {
      sessionStorage.setItem('logbookHighlightEntryId', entryId);
      sessionStorage.setItem('logbookInitialFilter', filter);
      if (shouldAutoOpenLogbookResolutionForViewer(type || '', profile, entry, defs)) {
        sessionStorage.setItem('logbookOpenResolutionEntryId', entryId);
      } else {
        sessionStorage.removeItem('logbookOpenResolutionEntryId');
      }
    } catch {
      /* ignore */
    }
    onOpenLogbook?.(filter);
  }

  return (
    <div className="dashboard-page" ref={pageRef} style={{ '--dash-context-height': '0px' } as CSSProperties}>
      <DashboardContextStack pageRef={pageRef} />

      <FeedbackInbox
        userId={profile.userId}
        title={t.dashboard.teamFeedback}
        stickySection
        reports={allReports}
        events={allEvents}
        profileRecords={profiles as Profile[]}
        onOpenLogbookEntry={(entryId, type, deepLinkFilter) => {
          const entry = allLogbookEntries.find((e) => e.id === entryId);
          if (decideLogbookNotificationClick(type || '', profile, entry, defs) === 'preview') {
            setLogbookPreview({ entryId, type, deepLinkFilter });
            return;
          }
          navigateToLogbookEntry(entryId, type, deepLinkFilter, entry);
        }}
      />

      <LogbookNotificationPreviewModal
        open={!!logbookPreview}
        entry={previewEntry}
        profile={profile}
        profiles={profiles as Profile[]}
        defs={defs}
        onClose={() => setLogbookPreview(null)}
        onOpenFullEntry={(entry) => {
          const meta = logbookPreview;
          setLogbookPreview(null);
          navigateToLogbookEntry(entry.id, meta?.type, meta?.deepLinkFilter, entry);
        }}
      />

      <div className="card">
        <h1 id="operation-dashboard-heading" data-dash-context="" data-dash-level="h1">
          {t.dashboard.title}
        </h1>
        <p className="small">
          {profile.displayName} — {profile.role}
        </p>
      </div>

      <div className="card">
        <div className="dashboard-filters-header">
          <h2 id="dashboard-filters-heading" data-dash-context="" data-dash-level="h2" style={{ margin: 0 }}>
            {t.dashboard.filters}
          </h2>
          <button type="button" className="export-trigger-btn" onClick={() => setExportOpen(true)}>
            {t.export.export}
          </button>
        </div>
        <div className="grid two">
          <label>
            {t.dashboard.from}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {t.dashboard.to}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            {t.common.store}
            <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)}>
              <option value="all">{t.dashboard.allStores}</option>
              {(displayStores as { id: string; code: string; name: string }[]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportType="dashboard"
        scopeOptions={[
          { value: 'filtered', label: t.export.scopeFiltered },
          { value: 'full_history', label: t.export.scopeFullHistory },
        ]}
        defaultScope="filtered"
        buildParams={(format: ExportFormat, scope: string) => ({
          exportType: 'dashboard',
          format,
          scope,
          startDate: from,
          endDate: to,
          filterStoreId,
        })}
      />

      <div className="grid four">
        <div className="card">
          <div className="small">{t.dashboard.completion}</div>
          <div className="metric">{metrics.completion}%</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.compliance}</div>
          <div className="metric">{metrics.compliance}%</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.reports}</div>
          <div className="metric">{metrics.reportCount}</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.failedItems}</div>
          <div className="metric">{metrics.failed.length}</div>
        </div>
      </div>

      <section className="dash-scroll-section">
        <div className="dash-section-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2
              id="logbook-issues-heading"
              data-dash-context=""
              data-dash-level="h2"
              style={{ margin: 0, flex: 1 }}
            >
              {t.logbook.dashboardTitle}
            </h2>
            {onOpenLogbook && (
              <button type="button" className="secondary" onClick={() => onOpenLogbook('all')}>
                {t.logbook.openInLogbook}
              </button>
            )}
          </div>
        </div>
        <div className="card">
          <div className="grid four" style={{ marginTop: 12 }}>
            <div>
              <div className="small">{t.logbook.statusOpen}</div>
              <div className="metric">{logbookMetrics.counts.open}</div>
            </div>
            <div>
              <div className="small">{t.logbook.statusInProgress}</div>
              <div className="metric">{logbookMetrics.counts.inProgress}</div>
            </div>
            <div>
              <div className="small">{t.logbook.statusWaiting}</div>
              <div className="metric">{logbookMetrics.counts.waitingApproval}</div>
            </div>
            <div>
              <div className="small">{t.logbook.statusOverdue}</div>
              <div className="metric">{logbookMetrics.counts.overdue}</div>
            </div>
            <div>
              <div className="small">{t.logbook.statusResolved}</div>
              <div className="metric">{logbookMetrics.counts.resolved}</div>
            </div>
            <div>
              <div className="small">{t.logbook.resolutionRate}</div>
              <div className="metric">
                {logbookMetrics.resolutionRate == null ? '—' : `${logbookMetrics.resolutionRate}%`}
              </div>
            </div>
            <div>
              <div className="small">{t.logbook.onTimeRate}</div>
              <div className="metric">
                {logbookMetrics.onTimeResolutionRate == null
                  ? '—'
                  : `${logbookMetrics.onTimeResolutionRate}%`}
              </div>
            </div>
            <div>
              <div className="small">{t.logbook.avgResolution}</div>
              <div className="metric">
                {formatDurationMs(logbookMetrics.avgResolutionDurationMs)}
              </div>
            </div>
          </div>
          <div className="grid two" style={{ marginTop: 12 }}>
            <label>
              {t.common.status}
              <select
                value={issueStatusFilter}
                onChange={(e) => setIssueStatusFilter(e.target.value)}
              >
                <option value="all">{t.common.all}</option>
                <option value="open">{t.logbook.statusOpen}</option>
                <option value="in_progress">{t.logbook.statusInProgress}</option>
                <option value="waiting_approval">{t.logbook.statusWaiting}</option>
                <option value="resolved">{t.logbook.statusResolved}</option>
              </select>
            </label>
            <label>
              {t.common.severity}
              <select
                value={issueSeverityFilter}
                onChange={(e) => setIssueSeverityFilter(e.target.value)}
              >
                <option value="all">{t.common.all}</option>
                {['info', 'warning', 'critical'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.logbook.assigneeRole}
              <select
                value={issueAssigneeFilter}
                onChange={(e) => setIssueAssigneeFilter(e.target.value)}
              >
                <option value="all">{t.common.all}</option>
                {['staff', 'hybrid', 'subleader', 'leader', 'manager'].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={issueOverdueOnly}
                onChange={(e) => setIssueOverdueOnly(e.target.checked)}
              />
              {t.logbook.overdueOnly}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={issueWaitingMyReview}
                onChange={(e) => setIssueWaitingMyReview(e.target.checked)}
              />
              {t.logbook.waitingMyReview}
            </label>
          </div>
          <div className="dash-scroll-subsection">
            <DashboardStickyTableHeader
              labels={logbookHeaderLabels}
              tableRef={logbookTableRef}
              scrollerRef={logbookTableScrollerRef}
            />
            <div
              className="dash-table-x"
              style={{ marginTop: 12 }}
              ref={logbookTableScrollerRef}
              role="region"
              aria-labelledby="logbook-issues-heading"
              tabIndex={0}
            >
              <table ref={logbookTableRef}>
                <thead>
                  <tr>
                    <th scope="col">{t.logbook.typeIssue}</th>
                    <th scope="col">{t.common.store}</th>
                    <th scope="col">{t.common.severity}</th>
                    <th scope="col">{t.logbook.assigneeRole}</th>
                    <th scope="col">{t.logbook.dueAt}</th>
                    <th scope="col">{t.common.status}</th>
                    <th scope="col">{t.logbook.overdueDuration}</th>
                    <th scope="col">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                {logbookIssueRows.map((e) => {
                  const status = resolveLogbookIssueStatus(e);
                  const store = e.store || (stores as { id: string; code: string }[]).find((s) => s.id === e.storeId);
                  return (
                    <tr key={e.id}>
                      <td>{e.content.slice(0, 60)}</td>
                      <td>{store?.code ?? e.storeId}</td>
                      <td>{e.severity}</td>
                      <td>
                        {(() => {
                          const role = e.assigneeRole || '—';
                          let ids: string[] = [];
                          try {
                            const parsed = JSON.parse(e.assigneeUserIdsJson || '[]') as unknown;
                            if (Array.isArray(parsed)) {
                              ids = parsed.filter((id): id is string => typeof id === 'string');
                            }
                          } catch {
                            ids = [];
                          }
                          if (ids.length === 0) return role;
                          return (
                            <>
                              {ids.map((uid, i) => {
                                const p = (profiles as Profile[]).find((x) => x.userId === uid);
                                const label = p?.displayName || p?.email || uid;
                                return (
                                  <span key={uid}>
                                    {i > 0 ? ', ' : ''}
                                    <IdentityWithAvatar profile={p}>{label}</IdentityWithAvatar>
                                  </span>
                                );
                              })}
                              {` (${role})`}
                            </>
                          );
                        })()}
                      </td>
                      <td className="small">
                        {e.dueAt ? new Date(e.dueAt).toLocaleString() : '—'}
                      </td>
                      <td>
                        <span className={badgeClass(status)}>{statusLabel(t, status)}</span>
                        {isIssueOverdue(e) && (
                          <span className="badge bad" style={{ marginLeft: 4 }}>
                            {t.logbook.statusOverdue}
                          </span>
                        )}
                      </td>
                      <td className="small">{formatDurationMs(overdueDurationMs(e))}</td>
                      <td>
                        {onOpenLogbook && (
                          <button
                            type="button"
                            className="secondary"
                            style={{ fontSize: 12, padding: '4px 8px', minHeight: 28 }}
                            onClick={() => {
                              try {
                                sessionStorage.setItem('logbookHighlightEntryId', e.id);
                              } catch {
                                /* ignore */
                              }
                              onOpenLogbook('all');
                            }}
                          >
                            {t.common.view}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!logbookIssueRows.length && (
                  <tr>
                    <td colSpan={8} className="small">
                      {t.logbook.noEntries}
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {canAccessChecklistItemProposals(profile.role, defs) && (
        <section className="dash-scroll-section">
          <div className="dash-section-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2
                id="checklist-proposals-heading"
                data-dash-context=""
                data-dash-level="h2"
                style={{ margin: 0, flex: 1 }}
              >
                {t.checklistProposals.metricsTitle}
              </h2>
              {onOpenProposals && (
                <button type="button" className="secondary" onClick={onOpenProposals}>
                  {t.checklistProposals.viewAll}
                </button>
              )}
            </div>
          </div>
          <div className="card">
            <div className="grid four" style={{ marginTop: 12 }}>
              <div>
                <div className="small">{t.checklistProposals.metricTotal}</div>
                <div className="metric">{proposalMetrics.metrics.total}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricPendingFirst}</div>
                <div className="metric">{proposalMetrics.metrics.pendingFirstApproval}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricPendingFinal}</div>
                <div className="metric">{proposalMetrics.metrics.pendingFinalApproval}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricChanges}</div>
                <div className="metric">{proposalMetrics.metrics.changesRequested}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricApproved}</div>
                <div className="metric">{proposalMetrics.metrics.fullyApproved}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricPublished}</div>
                <div className="metric">{proposalMetrics.metrics.published}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricRejected}</div>
                <div className="metric">{proposalMetrics.metrics.rejected}</div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricApprovalRate}</div>
                <div className="metric">
                  {proposalMetrics.metrics.approvalRate == null
                    ? '—'
                    : `${proposalMetrics.metrics.approvalRate}%`}
                </div>
              </div>
              <div>
                <div className="small">{t.checklistProposals.metricPublicationRate}</div>
                <div className="metric">
                  {proposalMetrics.metrics.publicationRate == null
                    ? '—'
                    : `${proposalMetrics.metrics.publicationRate}%`}
                </div>
              </div>
            </div>

            {proposalMetrics.list.length > 0 && (
              <div className="dash-scroll-subsection">
                <DashboardStickyTableHeader
                  labels={proposalsHeaderLabels}
                  tableRef={proposalsTableRef}
                  scrollerRef={proposalsTableScrollerRef}
                />
                <div
                  className="dash-table-x"
                  style={{ marginTop: 12 }}
                  ref={proposalsTableScrollerRef}
                  role="region"
                  aria-labelledby="checklist-proposals-heading"
                  tabIndex={0}
                >
                  <table ref={proposalsTableRef}>
                    <thead>
                      <tr>
                        <th scope="col">{t.checklistProposals.itemTitle}</th>
                        <th scope="col">{t.checklistProposals.section}</th>
                        <th scope="col">{t.checklistProposals.targetTemplate}</th>
                        <th scope="col">{t.checklistProposals.requester}</th>
                        <th scope="col">{t.checklistProposals.requesterRole}</th>
                        <th scope="col">{t.common.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposalMetrics.list.slice(0, 20).map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}</td>
                          <td>{p.section}</td>
                          <td>{p.templateNameSnapshot}</td>
                          <td>{p.requesterNameSnapshot}</td>
                          <td>{p.requesterRoleSnapshot}</td>
                          <td>
                            <span className={badgeClass(p.status)}>
                              {(t.checklistProposals.statuses as Record<string, string>)[p.status] ??
                                p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {approvalShare.length > 0 && (
        <div className="card table-wrap">
          <h2 id="approvals-by-role-heading" data-dash-context="" data-dash-level="h2">
            {t.dashboard.approvalsByRole}
          </h2>
          <table>
            <thead>
              <tr>
                <th>{t.common.role}</th>
                <th>{t.dashboard.count}</th>
                <th>{t.dashboard.share}</th>
              </tr>
            </thead>
            <tbody>
              {approvalShare.map((r) => (
                <tr key={r.role}>
                  <td>{r.role}</td>
                  <td>{r.count}</td>
                  <td>{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="dash-scroll-section">
        <div className="dash-section-heading">
          <h2
            id="feedback-reasons-heading"
            data-dash-context=""
            data-dash-level="h2"
            style={{ margin: 0 }}
          >
            {t.dashboard.feedbackReasons}
          </h2>
        </div>
        <div className="card feedback-freq-card">
          <p className="small">{t.dashboard.rejectionsPeriod}</p>

          {feedbackStats.rows.length > 0 ? (
            <>
              <div className="dash-scroll-subsection">
                <DashboardStickyTableHeader
                  labels={feedbackHeaderLabels}
                  tableRef={feedbackTableRef}
                  scrollerRef={feedbackTableScrollerRef}
                />
                <div
                  className="dash-table-x"
                  ref={feedbackTableScrollerRef}
                  role="region"
                  aria-labelledby="feedback-reasons-heading"
                  tabIndex={0}
                >
                  <table className="feedback-freq-table" ref={feedbackTableRef}>
                    <thead>
                      <tr>
                        <th scope="col">{t.review.feedbackReason}</th>
                        <th scope="col">{t.dashboard.count}</th>
                        <th scope="col">{t.dashboard.share}</th>
                        <th scope="col" style={{ width: '30%' }}>
                          {t.dashboard.feedbackFreq}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {feedbackStats.rows.map((row) => (
                        <tr key={row.code}>
                          <td>
                            {row.label}
                            {row.code === 'other' && feedbackStats.otherDetails.length > 0 && (
                              <button
                                type="button"
                                className="feedback-other-toggle"
                                onClick={() => setShowOtherDetails((v) => !v)}
                              >
                                {showOtherDetails ? t.dashboard.hideDetails : t.dashboard.showDetails}
                              </button>
                            )}
                          </td>
                          <td>{row.count}</td>
                          <td>{row.percent}%</td>
                          <td>
                            <div className="progress-bar" style={{ margin: 0 }}>
                              <div style={{ width: `${row.percent}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {showOtherDetails && feedbackStats.otherDetails.length > 0 && (
                <table className="feedback-other-detail">
                  <thead>
                    <tr>
                      <th>{t.common.date}</th>
                      <th>{t.common.store}</th>
                      <th>{t.dashboard.item}</th>
                      <th>{t.dashboard.feedback}</th>
                      <th>{t.dashboard.reviewer}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackStats.otherDetails.map((d) => (
                      <tr key={d.id}>
                        <td className="small">{d.reportDate}</td>
                        <td>{d.storeCode}</td>
                        <td>{d.itemTitle}</td>
                        <td className="feedback-other-text">{d.text}</td>
                        <td className="small">
                          {d.reviewerName}
                          <br />
                          <span className="badge">{d.reviewerRole}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="small">{t.dashboard.noFeedbackPeriod}</p>
          )}
        </div>
      </section>

      {isFailureHistoryEnabled() && (
        <>
          <FailureCorrectionHistory
            events={allEvents}
            reports={historyReports}
            profiles={profiles as Profile[]}
            from={from}
            to={to}
            storeIds={historyStoreIds}
            onExport={() => setFailureExportOpen(true)}
          />
          <ExportModal
            open={failureExportOpen}
            onClose={() => setFailureExportOpen(false)}
            exportType="failure_history"
            defaultFormat="csv"
            csvOnly
            scopeOptions={[
              { value: 'filtered', label: t.export.scopeFiltered },
              { value: 'full_history', label: t.export.scopeFullHistory },
            ]}
            defaultScope="filtered"
            buildParams={(format: ExportFormat, scope: string) => ({
              exportType: 'failure_history',
              format,
              scope,
              startDate: from,
              endDate: to,
              filterStoreId,
            })}
          />
        </>
      )}

      <section className="dash-scroll-section">
        <div className="dash-section-heading">
          <h2
            id="failed-items-heading"
            data-dash-context=""
            data-dash-level="h2"
            style={{ margin: 0 }}
          >
            {t.dashboard.failedItems}
          </h2>
        </div>
        <div className="card">
          <div className="dash-scroll-subsection">
            <DashboardStickyTableHeader
              labels={failedItemsHeaderLabels}
              tableRef={failedItemsTableRef}
              scrollerRef={failedItemsTableScrollerRef}
            />
            <div
              className="dash-table-x"
              ref={failedItemsTableScrollerRef}
              role="region"
              aria-labelledby="failed-items-heading"
              tabIndex={0}
            >
              <table ref={failedItemsTableRef}>
                <thead>
                  <tr>
                    <th scope="col">{t.dashboard.item}</th>
                    <th scope="col">{t.common.section}</th>
                    <th scope="col">{t.dashboard.category}</th>
                    <th scope="col">{t.dashboard.times}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.failed.map((f) => (
                    <tr key={f.title}>
                      <td>{f.title}</td>
                      <td>{f.section}</td>
                      <td>{f.failureCategory}</td>
                      <td>{f.count}</td>
                    </tr>
                  ))}
                  {!metrics.failed.length && (
                    <tr>
                      <td colSpan={4}>{t.dashboard.noFailedItems}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <ScheduledTaskCompletion
        templates={allTemplates}
        reports={reports}
        events={allEvents}
        from={from}
        to={to}
        storeIds={historyStoreIds}
      />

      <section className="dash-scroll-section">
        <div className="dash-section-heading">
          <h2
            id="recent-reports-heading"
            data-dash-context=""
            data-dash-level="h2"
            style={{ margin: 0 }}
          >
            {t.dashboard.recentReports}
          </h2>
        </div>
        <div className="card">
          <div className="dash-scroll-subsection">
            <DashboardStickyTableHeader
              labels={recentReportsHeaderLabels}
              tableRef={recentReportsTableRef}
              scrollerRef={recentReportsTableScrollerRef}
            />
            <div
              className="dash-table-x"
              ref={recentReportsTableScrollerRef}
              role="region"
              aria-labelledby="recent-reports-heading"
              tabIndex={0}
            >
              <table ref={recentReportsTableRef}>
                <thead>
                  <tr>
                    <th scope="col">{t.common.store}</th>
                    <th scope="col">{t.common.template}</th>
                    <th scope="col">{t.common.date}</th>
                    <th scope="col">{t.common.status}</th>
                    <th scope="col">{t.dashboard.completion}</th>
                    <th scope="col">{t.dashboard.leadTime}</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.slice(0, 20).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.storeCode}</strong>
                      </td>
                      <td>{r.templateName}</td>
                      <td>{r.reportDate}</td>
                      <td>
                        <span className={badgeClass(r.status)}>{statusLabel(t, r.status)}</span>
                      </td>
                      <td>{r.completionPercent ?? 0}%</td>
                      <td>
                        <ReportTimelineLeadCell
                          report={r}
                          events={allEvents.filter((e) => e.reportId === r.id)}
                        />
                      </td>
                    </tr>
                  ))}
                  {!reports.length && (
                    <tr>
                      <td colSpan={6}>
                        {reportsLoading && !lastGoodDashRef.current
                          ? t.common.loading
                          : t.dashboard.noReportsInRange}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
