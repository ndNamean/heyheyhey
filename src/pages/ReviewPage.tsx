import { useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canAccessAllStores, canReview } from '../lib/roles';
import {
  buildReviewReportsWhere,
  canFinaliseReportResponses,
  canRemindReportInStoreChat,
  canReviewReport,
  canReviewReportItem,
  filterReportsAwaitingReview,
  firstActionableReportResponse,
  listOptionalNotStartedToApprove,
  resolveFinaliseReportStatus,
} from '../lib/reportReview';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildItemReviewNotifications,
  buildReportFinalizedNotifications,
} from '../lib/notifications';
import { schedulePushDeliveryFromTxs } from '../lib/pushDelivery';
import {
  buildItemReviewEvent,
  buildLogbookIssueCreatedEvents,
  buildLogbookResolutionApprovedEvent,
  buildLogbookResolutionRejectedEvent,
  buildReportFinalizedEvent,
} from '../lib/reviewEvents';
import { deliverLogbookEvent } from '../lib/logbookNotifyClient';
import { deliverReportEvent } from '../lib/reportNotifyClient';
import { resolveActorDisplay } from '../lib/actorDisplay';
import {
  buildSubmitterNeedsActionEdgeTxs,
  computeSubmitterNeedsAction,
  readSubmitterNeedsAction,
} from '../lib/reportNeedsAction';
import { badgeClass, nowIso } from '../lib/utils';
import {
  clearReviewFilterChip,
  countActiveReviewFilters,
  defaultReviewFilterState,
  filterLogbookIssuesForReview,
  filterReportsForReview,
  isReviewFilterActive,
  listReviewFilterChips,
  resolveReviewStoreCatalog,
  REVIEW_DATE_PRESETS,
  type ReviewDatePreset,
} from '../lib/reviewFilters';
import { profileVisibilityStoreIds, storesSelectableBy } from '../lib/inviteScope';
import ProofPhoto from '../components/ProofPhoto';
import ProofMediaDetails from '../components/ProofMediaDetails';
import ReviewFeedbackModal, { type FeedbackResult } from '../components/ReviewFeedbackModal';
import FinaliseLogbookIssuesModal, {
  type FinaliseLogbookIssuesConfirm,
} from '../components/FinaliseLogbookIssuesModal';
import { isVideoMedia } from '../lib/mediaMime';
import { formatMediaCaptureTime, resolveCaptureTimezone, ymdInTimeZone } from '../lib/proofTime';
import ReportTimeline, { LogbookTimeline } from '../components/ReportTimeline';
import IdentityWithAvatar from '../components/profileAvatar/IdentityWithAvatar';
import { LinkifiedText } from '../components/LinkifiedText';
import {
  canReviewLogbookIssue,
  getIssueConfigurationState,
  isIssueOverdue,
  isLogbookIssue,
  issueCreateFields,
  resolveLogbookIssueStatus,
  resolveResolutionProofs,
  resolveSourceMedia,
  serializeAssigneeUserIds,
} from '../lib/logbook';
import {
  mapNeedCorrectionItemToLogbookIssue,
  needCorrectionItemsForLogbookIssues,
} from '../lib/finaliseLogbookIssues';
import { OPEN_LOGBOOK_EVENT, type LogbookDeepLink } from '../lib/logbookDeepLink';
import {
  proofTypeLabel,
  resolveLogbookProofType,
} from '../lib/logbookResolution';
import type {
  LogbookEntry,
  MediaRecord,
  Profile,
  Report,
  ReportResponse,
  ReviewEvent,
  Store,
} from '../types';

interface Props {
  profile: Profile;
  /** Deep-link: force Reports surface and highlight a report card. */
  highlightReportId?: string | null;
  highlightOpenKey?: number;
  initialSurface?: 'reports' | 'logbook';
}

interface PendingFeedback {
  report: Report;
  response: ReportResponse;
  status: 'rejected' | 'need_correction';
}

type ReviewSurface = 'reports' | 'logbook';

interface PendingFinaliseIssues {
  report: Report;
  items: ReportResponse[];
}

function keepReviewCardFocused(reportId: string) {
  const card = document.querySelector(`[data-report-id="${reportId}"]`);
  if (!(card instanceof HTMLElement)) return;
  if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
  card.focus({ preventScroll: true });
}

type InstantQueryErrorLike = {
  message?: string;
  hint?: unknown;
  code?: unknown;
  type?: unknown;
};

function reviewDatePresetLabel(t: ReturnType<typeof useLang>['t'], preset: ReviewDatePreset): string {
  switch (preset) {
    case 'all':
      return t.common.all;
    case 'today':
      return t.review.datePresetToday;
    case 'yesterday':
      return t.review.datePresetYesterday;
    case 'last2days':
      return t.review.datePresetLast2Days;
    case 'last7days':
      return t.review.datePresetLast7Days;
  }
}

function instantErrorMeta(error: unknown): InstantQueryErrorLike {
  if (!error || typeof error !== 'object') return { message: String(error ?? '') };
  const e = error as InstantQueryErrorLike;
  return {
    message: typeof e.message === 'string' ? e.message : String(error),
    hint: e.hint,
    code: e.code ?? e.type,
  };
}

function countReviewQueryPayload(data: unknown, extraMedia = 0): {
  reports: number;
  responses: number;
  media: number;
  profiles: number;
  events: number;
} {
  const d = data as {
    reports?: Array<{ responses?: Array<{ media?: unknown[] }> }>;
    profiles?: unknown[];
    reviewEvents?: unknown[];
    mediaRecords?: unknown[];
  } | null;
  if (!d) {
    return { reports: 0, responses: 0, media: extraMedia, profiles: 0, events: 0 };
  }
  let responses = 0;
  let nestedMedia = 0;
  for (const report of d.reports ?? []) {
    for (const response of report.responses ?? []) {
      responses += 1;
      nestedMedia += response.media?.length ?? 0;
    }
  }
  return {
    reports: d.reports?.length ?? 0,
    responses,
    media: extraMedia || nestedMedia || (d.mediaRecords?.length ?? 0),
    profiles: d.profiles?.length ?? 0,
    events: d.reviewEvents?.length ?? 0,
  };
}

function mergeReportMedia(slim: Report[], rich: Report[]): Report[] {
  if (!slim.length) return slim;
  if (!rich.length) return slim;
  const byId = new Map(rich.map((report) => [report.id, report]));
  return slim.map((report) => {
    const full = byId.get(report.id);
    return full ? { ...report, responses: full.responses ?? report.responses } : report;
  });
}

function isConnectionLikeLoadFailure(
  connectionStatus: string,
  error: unknown,
): boolean {
  if (connectionStatus === 'closed' || connectionStatus === 'errored') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = instantErrorMeta(error).message?.toLowerCase() ?? '';
  return /offline|network|connection|failed to fetch|net::|not connected/.test(message);
}

export default function ReviewPage({
  profile,
  highlightReportId = null,
  highlightOpenKey = 0,
  initialSurface = 'reports',
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);
  const [pendingFinaliseIssues, setPendingFinaliseIssues] =
    useState<PendingFinaliseIssues | null>(null);
  const [remindBusyReportId, setRemindBusyReportId] = useState<string | null>(null);
  const [remindMsgByReportId, setRemindMsgByReportId] = useState<Record<string, string>>({});
  const [surface, setSurface] = useState<ReviewSurface>(initialSurface);
  const [filters, setFilters] = useState(defaultReviewFilterState);
  const [reviewFiltersOpen, setReviewFiltersOpen] = useState(false);
  const [isMobileFilters, setIsMobileFilters] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)').matches : false,
  );
  const [reportsQueryPaused, setReportsQueryPaused] = useState(false);
  const [holdReportsLive, setHoldReportsLive] = useState(false);
  const [logbookQueryPaused, setLogbookQueryPaused] = useState(false);
  const lastHighlightScrollKey = useRef('');
  const lastLoggedReportsSig = useRef('');
  const lastLoggedLogbookSig = useRef('');
  const lastGoodReportsRef = useRef<{
    reports: Report[];
    profiles: Profile[];
    events: ReviewEvent[];
  } | null>(null);
  const lastGoodLogbookRef = useRef<{
    issues: LogbookEntry[];
    profiles: Profile[];
    events: ReviewEvent[];
  } | null>(null);
  const lastGoodStoresRef = useRef<Store[]>([]);
  const lastGoodRichReportsRef = useRef<Report[]>([]);

  const connectionStatus = db.useConnectionStatus();

  useEffect(() => {
    if (highlightReportId) {
      setSurface('reports');
    } else if (initialSurface) {
      setSurface(initialSurface);
    }
  }, [highlightReportId, highlightOpenKey, initialSurface]);

  useEffect(() => {
    if (!reportsQueryPaused) return;
    setReportsQueryPaused(false);
  }, [reportsQueryPaused]);

  useEffect(() => {
    if (!logbookQueryPaused) return;
    setLogbookQueryPaused(false);
  }, [logbookQueryPaused]);

  const storeIds = useMemo(
    () => (profile.stores ?? []).map((s) => s.id).filter(Boolean),
    [profile.stores],
  );
  const reportsWhere = useMemo(
    () =>
      buildReviewReportsWhere({
        canAccessAllStores: canAccessAllStores(profile.role, defs),
        storeIds,
        highlightReportId,
      }),
    [defs, highlightReportId, profile.role, storeIds],
  );

  const reportsQuery = useMemo(
    () =>
      reportsQueryPaused || holdReportsLive || reportsWhere === null
        ? null
        : {
            reports: {
              ...(reportsWhere ? { $: { where: reportsWhere } } : {}),
              responses: {},
              store: {},
            },
          },
    [holdReportsLive, reportsQueryPaused, reportsWhere],
  );

  const profilesQuery = useMemo(() => ({ profiles: { stores: {}, avatarFile: {} } }), []);
  const storesQuery = useMemo(() => ({ stores: {} }), []);

  const logbookQuery = useMemo(
    () =>
      logbookQueryPaused || surface !== 'logbook'
        ? null
        : {
            logbookEntries: {
              store: {},
              photo: {},
              sourceMedia: {},
              resolutionMedia: {},
              resolutionProofHistory: {},
            },
          },
    [logbookQueryPaused, surface],
  );

  const { data, isLoading: reportsLoading, error: reportsError } = db.useQuery(reportsQuery);
  useEffect(() => {
    if (data && !reportsError) setHoldReportsLive(true);
  }, [data, reportsError]);
  const { data: profilesData } = db.useQuery(profilesQuery);
  const { data: storesData } = db.useQuery(storesQuery);
  const {
    data: logbookData,
    isLoading: logbookLoading,
    error: logbookError,
  } = db.useQuery(logbookQuery);

  const followupReportIds = useMemo(() => {
    const live = ((data?.reports ?? []) as Report[]).map((r) => r.id).filter(Boolean);
    if (live.length) return live;
    return (lastGoodReportsRef.current?.reports ?? []).map((r) => r.id).filter(Boolean);
  }, [data?.reports, holdReportsLive]);

  const eventsQuery = useMemo(() => {
    if (surface === 'logbook') {
      const ids = ((logbookData?.logbookEntries ?? []) as LogbookEntry[])
        .map((e) => e.id)
        .filter(Boolean);
      if (!ids.length) return null;
      return {
        reviewEvents: {
          $: { where: { logbookEntryId: { $in: ids } } },
        },
      };
    }
    if (!holdReportsLive) return null;
    const ids = followupReportIds;
    if (!ids.length) return null;
    return {
      reviewEvents: {
        $: { where: { reportId: { $in: ids } } },
      },
    };
  }, [followupReportIds, holdReportsLive, logbookData?.logbookEntries, surface]);

  const { data: eventsData } = db.useQuery(eventsQuery);

  const reportsMediaQuery = useMemo(() => {
    if (!holdReportsLive) return null;
    const ids = followupReportIds;
    if (!ids.length) return null;
    return {
      reports: {
        $: { where: { id: { $in: ids } } },
        responses: { media: {} },
      },
    };
  }, [followupReportIds, holdReportsLive]);

  const { data: reportsMediaData, error: reportsMediaError } = db.useQuery(reportsMediaQuery);
  const richReports = (reportsMediaData?.reports ?? []) as Report[];
  if (richReports.length && !reportsMediaError) {
    lastGoodRichReportsRef.current = richReports;
  }
  const stableRichReports = richReports.length ? richReports : lastGoodRichReportsRef.current;

  const allProfiles: Profile[] = (profilesData?.profiles ?? []) as Profile[];
  const allEvents = (eventsData?.reviewEvents ?? []) as ReviewEvent[];
  const queryStores: Store[] = (storesData?.stores ?? []) as Store[];
  if (queryStores.length) {
    lastGoodStoresRef.current = queryStores;
  }
  const stableQueryStores = queryStores.length ? queryStores : lastGoodStoresRef.current;
  const allLogbookEntries = (logbookData?.logbookEntries ?? []) as LogbookEntry[];
  const reports = useMemo(
    () =>
      filterReportsAwaitingReview(
        mergeReportMedia((data?.reports ?? []) as Report[], stableRichReports),
        profile,
        defs,
      ),
    [data?.reports, defs, profile, stableRichReports],
  );
  const logbookIssues = useMemo(() => {
    return allLogbookEntries.filter(
      (e) =>
        isLogbookIssue(e) &&
        resolveLogbookIssueStatus(e) === 'waiting_approval' &&
        canReviewLogbookIssue(profile, e, defs),
    );
  }, [allLogbookEntries, profile, defs]);

  const reportsQueryOk = data != null && !reportsError;
  if (reportsQueryOk) {
    lastGoodReportsRef.current = {
      reports,
      profiles: allProfiles,
      events: allEvents,
    };
  }

  const logbookQueryActive = surface === 'logbook' && !logbookQueryPaused;
  const logbookQueryOk = logbookQueryActive && logbookData != null && !logbookError;
  if (logbookQueryOk) {
    lastGoodLogbookRef.current = {
      issues: logbookIssues,
      profiles: allProfiles,
      events: allEvents,
    };
  }

  const reportsHasLastGood = lastGoodReportsRef.current != null;
  const logbookHasLastGood = lastGoodLogbookRef.current != null;
  const reportsRefreshFailed = Boolean(reportsError) && reportsHasLastGood;
  const logbookRefreshFailed = Boolean(logbookError) && logbookHasLastGood && surface === 'logbook';
  const reportsInitialFailed = Boolean(reportsError) && !reportsHasLastGood;
  const logbookInitialFailed =
    Boolean(logbookError) && !logbookHasLastGood && surface === 'logbook';

  const displayReports = mergeReportMedia(
    !reportsQueryOk && lastGoodReportsRef.current
      ? lastGoodReportsRef.current.reports
      : reports,
    stableRichReports,
  );
  const displayLogbookIssues =
    !logbookQueryOk && lastGoodLogbookRef.current
      ? lastGoodLogbookRef.current.issues
      : logbookIssues;
  const displayProfiles =
    surface === 'logbook' && !logbookQueryOk && lastGoodLogbookRef.current
      ? lastGoodLogbookRef.current.profiles
      : !reportsQueryOk && lastGoodReportsRef.current
        ? lastGoodReportsRef.current.profiles
        : allProfiles;
  const displayEvents =
    allEvents.length
      ? allEvents
      : surface === 'logbook' && !logbookQueryOk && lastGoodLogbookRef.current
        ? lastGoodLogbookRef.current.events
        : lastGoodReportsRef.current?.events ?? [];

  const selectableStores = useMemo(
    () =>
      storesSelectableBy(
        profile.role,
        profileVisibilityStoreIds(profile),
        resolveReviewStoreCatalog(profile, defs, stableQueryStores),
        defs,
      ),
    [profile, stableQueryStores, defs],
  );

  useEffect(() => {
    if (filters.storeId === 'all') return;
    if (selectableStores.some((s) => s.id === filters.storeId)) return;
    setFilters((prev) => ({ ...prev, storeId: 'all' }));
  }, [filters.storeId, selectableStores]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => setIsMobileFilters(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const filteredReports = useMemo(
    () =>
      filterReportsForReview(displayReports, filters, {
        keepReportIds: highlightReportId ? [highlightReportId] : [],
      }),
    [displayReports, filters, highlightReportId],
  );

  const filteredLogbookIssues = useMemo(
    () => filterLogbookIssuesForReview(displayLogbookIssues, filters),
    [displayLogbookIssues, filters],
  );

  const filterActive = isReviewFilterActive(filters);
  const activeFilterCount = countActiveReviewFilters(filters);
  const showStoreFilter = selectableStores.length > 1;
  const storeFilterNarrowed = filters.storeId !== 'all';

  const filterChips = useMemo(() => {
    const store = selectableStores.find((s) => s.id === filters.storeId);
    const storeLabel =
      showStoreFilter && storeFilterNarrowed && store
        ? `${store.code} — ${store.name}`
        : undefined;
    const datePresetLabels = Object.fromEntries(
      REVIEW_DATE_PRESETS.map((preset) => [preset, reviewDatePresetLabel(t, preset)]),
    ) as Record<ReviewDatePreset, string>;
    return listReviewFilterChips(filters, {
      datePreset: datePresetLabels,
      storeLabel,
    });
  }, [filters, selectableStores, showStoreFilter, storeFilterNarrowed, t]);

  useEffect(() => {
    if (!reportsError) return;
    const meta = instantErrorMeta(reportsError);
    const sig = `reports|${meta.message}|${String(meta.hint ?? '')}|${String(meta.code ?? '')}`;
    if (sig === lastLoggedReportsSig.current) return;
    lastLoggedReportsSig.current = sig;
    const payload = countReviewQueryPayload(data, countReviewQueryPayload(reportsMediaData).media);
    console.error('[review-load]', {
      surface,
      queryKind: 'reports',
      message: meta.message,
      hint: meta.hint,
      code: meta.code,
      hasData: data != null,
      filteredCount: reports.length,
      profileRole: profile.role,
      storeIdsLength: storeIds.length,
      connectionStatus,
      ...payload,
      nestsAvatarFile: false,
      nestsMedia: false,
      eventsSeparate: true,
    });
  }, [
    connectionStatus,
    data,
    profile.role,
    reports.length,
    reportsError,
    reportsMediaData,
    storeIds.length,
    surface,
  ]);

  useEffect(() => {
    if (!logbookError || surface !== 'logbook') return;
    const meta = instantErrorMeta(logbookError);
    const sig = `logbook|${meta.message}|${String(meta.hint ?? '')}|${String(meta.code ?? '')}`;
    if (sig === lastLoggedLogbookSig.current) return;
    lastLoggedLogbookSig.current = sig;
    console.error('[review-load]', {
      surface,
      queryKind: 'logbook',
      message: meta.message,
      hint: meta.hint,
      code: meta.code,
      hasData: logbookData != null,
      filteredCount: logbookIssues.length,
      profileRole: profile.role,
      storeIdsLength: storeIds.length,
      connectionStatus,
    });
  }, [
    connectionStatus,
    logbookData,
    logbookError,
    logbookIssues.length,
    profile.role,
    storeIds.length,
    surface,
  ]);

  useEffect(() => {
    if (!highlightReportId || surface !== 'reports') return;
    const key = `${highlightReportId}:${highlightOpenKey}`;
    if (lastHighlightScrollKey.current === key) return;
    const el = document.querySelector(`[data-report-id="${highlightReportId}"]`);
    if (!(el instanceof HTMLElement)) return;
    lastHighlightScrollKey.current = key;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('report-card--highlight');
    const timer = window.setTimeout(() => {
      el.classList.remove('report-card--highlight');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [highlightReportId, highlightOpenKey, filteredReports, surface]);

  if (!canReview(profile.role, defs)) {
    return <div className="card">{t.review.noPermission}</div>;
  }

  const reportsBlockingMessage = isConnectionLikeLoadFailure(connectionStatus, reportsError)
    ? t.review.loadError
    : t.review.loadUnavailable;
  const logbookBlockingMessage = isConnectionLikeLoadFailure(connectionStatus, logbookError)
    ? t.review.loadError
    : t.review.loadUnavailable;

  async function approveLogbookIssue(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.reviewNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'resolved',
        resolvedAt: now,
        resolvedByUserId: entry.resolutionSubmittedByUserId || '',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionApprovedEvent(entry, profile, note.trim()),
    ]);
    void deliverLogbookEvent({
      entryId: entry.id,
      eventType: 'approved',
      eventVersion: now,
      note: note.trim(),
    });
  }

  async function requestLogbookCorrection(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.correctionNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'in_progress',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionRejectedEvent(entry, profile, note.trim()),
    ]);
    void deliverLogbookEvent({
      entryId: entry.id,
      eventType: 'correction_requested',
      eventVersion: now,
      note: note.trim(),
    });
  }

  function openFeedbackModal(
    report: Report,
    response: ReportResponse,
    status: 'rejected' | 'need_correction',
  ) {
    if (!canReviewReportItem(profile, report, response, defs)) {
      alert(t.review.noPermissionItem);
      return;
    }
    setPendingFeedback({ report, response, status });
  }

  async function updateResponseStatus(
    report: Report,
    response: ReportResponse,
    status: 'approved' | 'rejected' | 'need_correction',
    feedback?: FeedbackResult,
  ) {
    if (!canReviewReportItem(profile, report, response, defs)) {
      alert(t.review.noPermissionItem);
      return;
    }

    const reason = feedback?.rejectionReason ?? '';

    const now = nowIso();
    const responses = (report.responses ?? []) as ReportResponse[];
    const patchedResponses = responses.map((r) =>
      r.id === response.id
        ? {
            ...r,
            status,
            rejectionReason: reason,
            feedbackCode: feedback?.feedbackCode ?? '',
            feedbackNote: feedback?.feedbackNote ?? '',
          }
        : r,
    );
    const prevNeedsAction = readSubmitterNeedsAction(report);
    const nextNeedsAction = computeSubmitterNeedsAction(report.status, patchedResponses);
    const notificationTxs = buildItemReviewNotifications(
      report,
      response,
      status,
      reason,
      profile,
      allProfiles,
      responses,
      defs,
    );
    const needsActionEdgeTxs = await buildSubmitterNeedsActionEdgeTxs(
      report.submittedByUserId,
      prevNeedsAction,
      nextNeedsAction,
      null,
      { now },
    );

    await db.transact([
      db.tx.reportResponses[response.id].update({
        status,
        rejectionReason: reason,
        feedbackCode: feedback?.feedbackCode ?? '',
        feedbackNote: feedback?.feedbackNote ?? '',
        approvedByUserId: profile.userId,
        approvedAt: now,
        updatedAt: now,
        // Lazy backfill storeId on legacy responses so Instant store-scoped rules apply.
        ...(!response.storeId && report.storeId ? { storeId: report.storeId } : {}),
      }),
      db.tx.reports[report.id].update({
        submitterNeedsAction: nextNeedsAction,
      }),
      buildItemReviewEvent(report, response, status, reason, profile, now, {
        feedbackCode: feedback?.feedbackCode,
        feedbackNote: feedback?.feedbackNote,
      }),
      ...notificationTxs,
      ...needsActionEdgeTxs,
    ] as Parameters<typeof db.transact>[0]);
    schedulePushDeliveryFromTxs(notificationTxs);

    keepReviewCardFocused(report.id);

    // First reject/correction in a waiting cycle → Store Chat handoff (server-deduped).
    if (status === 'rejected' || status === 'need_correction') {
      const cycleKey = String(report.updatedAt || report.submittedAt || now).trim() || now;
      void deliverReportEvent({
        reportId: report.id,
        eventType: 'report_action_required',
        eventVersion: cycleKey,
        note: reason,
        itemTitle: response.title,
        responseId: response.id,
      });
    }
  }

  async function handleFeedbackConfirm(result: FeedbackResult) {
    if (!pendingFeedback) return;
    const { report, response, status } = pendingFeedback;
    setPendingFeedback(null);
    await updateResponseStatus(report, response, status, result);
  }

  async function remindReportInStoreChat(report: Report) {
    if (!canReviewReport(profile, report, defs)) {
      alert(t.review.noPermissionItem);
      return;
    }
    const responses = (report.responses ?? []) as ReportResponse[];
    if (!canRemindReportInStoreChat(responses)) {
      alert(t.review.noPermissionItem);
      return;
    }
    const actionable = firstActionableReportResponse(responses);
    setRemindBusyReportId(report.id);
    setRemindMsgByReportId((prev) => {
      const next = { ...prev };
      delete next[report.id];
      return next;
    });
    try {
      const result = await deliverReportEvent({
        reportId: report.id,
        eventType: 'report_action_required',
        eventVersion: `remind:${nowIso()}`,
        note:
          actionable?.rejectionReason?.trim() ||
          actionable?.feedbackNote?.trim() ||
          (actionable?.status === 'not_started' ? t.review.remindNotStartedNote : undefined),
        itemTitle: actionable?.title?.trim() || undefined,
        responseId: actionable?.id,
      });
      setRemindMsgByReportId((prev) => ({
        ...prev,
        [report.id]: result.ok ? t.review.remindSuccess : result.message || t.review.remindFailed,
      }));
    } catch (e) {
      setRemindMsgByReportId((prev) => ({
        ...prev,
        [report.id]: e instanceof Error ? e.message : t.review.remindFailed,
      }));
    } finally {
      setRemindBusyReportId(null);
    }
  }

  async function markReportApproved(report: Report) {
    if (!canReviewReport(profile, report, defs)) {
      alert(t.review.noPermissionItem);
      return;
    }
    const responses = (report.responses ?? []) as ReportResponse[];
    if (!canFinaliseReportResponses(responses)) {
      alert(t.review.noPermissionItem);
      return;
    }
    const newStatus = resolveFinaliseReportStatus(responses);
    if (newStatus === 'waiting_approval') {
      alert(t.review.noPermissionItem);
      return;
    }
    const now = nowIso();
    const optionalToApprove = listOptionalNotStartedToApprove(responses);
    const postApproveResponses = responses.map((r) =>
      optionalToApprove.some((o) => o.id === r.id) ? { ...r, status: 'approved' as const } : r,
    );
    const compliancePercent =
      postApproveResponses.length
        ? Math.round(
            (postApproveResponses.filter((r) => r.status === 'approved').length /
              postApproveResponses.length) *
              100,
          )
        : 0;

    const autoApproveTxs = optionalToApprove.flatMap((response) => [
      db.tx.reportResponses[response.id].update({
        status: 'approved',
        rejectionReason: '',
        feedbackCode: '',
        feedbackNote: '',
        approvedByUserId: profile.userId,
        approvedAt: now,
        updatedAt: now,
        ticked: true,
        ...(!response.storeId && report.storeId ? { storeId: report.storeId } : {}),
      }),
      buildItemReviewEvent(report, response, 'approved', '', profile, now),
    ]);

    const notificationTxs = buildReportFinalizedNotifications(
      report,
      newStatus,
      compliancePercent,
      profile,
      allProfiles,
      postApproveResponses,
      defs,
    );
    const nextNeedsAction = newStatus === 'rejected' || newStatus === 'need_correction';
    const prevNeedsAction = readSubmitterNeedsAction(report);
    const needsActionEdgeTxs = await buildSubmitterNeedsActionEdgeTxs(
      report.submittedByUserId,
      prevNeedsAction,
      nextNeedsAction,
      null,
      { now },
    );

    try {
      await db.transact([
        ...autoApproveTxs,
        db.tx.reports[report.id].update({
          status: newStatus,
          compliancePercent,
          submitterNeedsAction: nextNeedsAction,
          updatedAt: now,
        }),
        buildReportFinalizedEvent(report, newStatus, profile, now),
        ...notificationTxs,
        ...needsActionEdgeTxs,
      ] as Parameters<typeof db.transact>[0]);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.review.loadError);
      return;
    }
    schedulePushDeliveryFromTxs(notificationTxs);

    // Closing Store Chat card for approved + issues; server skips issues when
    // action_required already delivered this cycle, and skips waiting_approval.
    const cycleKey =
      String(report.updatedAt || report.submittedAt || now).trim() || now;
    void deliverReportEvent({
      reportId: report.id,
      eventType: 'report_finalized',
      eventVersion: cycleKey,
      reportStatus: newStatus,
    });

    const issueCandidates = needCorrectionItemsForLogbookIssues(
      postApproveResponses,
      allLogbookEntries,
    );
    if (issueCandidates.length > 0) {
      setPendingFinaliseIssues({ report, items: issueCandidates });
    }
  }

  async function createLogbookIssuesFromFinalise(result: FinaliseLogbookIssuesConfirm) {
    const pending = pendingFinaliseIssues;
    setPendingFinaliseIssues(null);
    if (!pending) return;

    const { report, items } = pending;
    const selected = items.filter((item) => result.selectedResponseIds.includes(item.id));
    if (!selected.length) return;

    if (!canReview(profile.role, defs)) {
      alert(t.logbook.noCreatePermission);
      return;
    }
    if (
      report.storeId &&
      !canAccessAllStores(profile.role, defs) &&
      !storeIds.includes(report.storeId)
    ) {
      alert(t.logbook.storeNotAllowed);
      return;
    }

    const dueAtIso = new Date(result.dueAtLocal).toISOString();
    if (!Number.isFinite(Date.parse(dueAtIso))) {
      alert(t.logbook.dueRequired);
      return;
    }

    const store = report.store;
    const storeCoords =
      store && Number.isFinite(store.lat) && Number.isFinite(store.lng)
        ? { lat: store.lat, lng: store.lng }
        : null;
    const createdTimezone = resolveCaptureTimezone(storeCoords);
    const now = new Date();
    const createdAt = now.toISOString();
    const date = ymdInTimeZone(now, createdTimezone);

    const createdEntryIds: string[] = [];
    const txs: unknown[] = [];

    for (const response of selected) {
      if (needCorrectionItemsForLogbookIssues([response], allLogbookEntries).length === 0) {
        continue;
      }
      const mapped = mapNeedCorrectionItemToLogbookIssue(report, response);
      const entryId = id();
      const typeFields = {
        ...issueCreateFields(
          mapped.assigneeRole,
          dueAtIso,
          mapped.resolutionProofType,
          mapped.resolutionRequirement,
          mapped.assigneeUserIds,
        ),
        sourceReportId: mapped.sourceReportId,
        sourceResponseId: mapped.sourceResponseId,
      };

      txs.push(
        db.tx.logbookEntries[entryId].update({
          storeId: report.storeId,
          authorUserId: profile.userId,
          date,
          shift: 'AM',
          content: mapped.content,
          severity: result.severity,
          requiresAck: false,
          ackUserIdsJson: '[]',
          createdAt,
          updatedAt: createdAt,
          createdTimezone,
          ...typeFields,
        }),
      );
      if (report.storeId) {
        txs.push(db.tx.logbookEntries[entryId].link({ store: report.storeId }));
      }
      for (const fileId of mapped.sourceFileIds) {
        txs.push(db.tx.logbookEntries[entryId].link({ sourceMedia: fileId }));
      }

      const entryLike = {
        id: entryId,
        storeId: report.storeId,
        content: mapped.content,
        assigneeRole: mapped.assigneeRole,
        assigneeUserIdsJson: serializeAssigneeUserIds(mapped.assigneeUserIds),
        dueAt: dueAtIso,
        severity: result.severity,
        entryType: 'issue' as const,
        isAnnouncement: false,
        status: 'open' as const,
        resolutionProofType: mapped.resolutionProofType,
        resolutionRequirement: mapped.resolutionRequirement,
      } as LogbookEntry;
      txs.push(...buildLogbookIssueCreatedEvents(entryLike, profile, createdAt));
      createdEntryIds.push(entryId);
    }

    if (!txs.length) return;

    try {
      await db.transact(txs as Parameters<typeof db.transact>[0]);
    } catch (e) {
      const raw = instantErrorMeta(e).message ?? '';
      alert(
        /perms-pass|Permission denied/i.test(raw)
          ? t.logbook.noCreatePermission
          : raw || t.review.loadError,
      );
      return;
    }

    for (const entryId of createdEntryIds) {
      void deliverLogbookEvent({ entryId, eventType: 'issue_assigned', eventVersion: createdAt });
    }

    const msg = t.review.logbookIssuesCreated.replace('{n}', String(createdEntryIds.length));
    const firstId = createdEntryIds[0];
    if (firstId && window.confirm(`${msg}\n\n${t.review.openLogbookAfterCreate}`)) {
      const link: LogbookDeepLink = {
        entryId: firstId,
        filter: 'my-assigned',
        storeId: report.storeId || undefined,
      };
      window.dispatchEvent(new CustomEvent(OPEN_LOGBOOK_EVENT, { detail: link }));
    } else {
      alert(msg);
    }
  }

  function clearAllReviewFilters() {
    setFilters(defaultReviewFilterState());
  }

  function renderReviewFiltersBody() {
    return (
      <>
        <div className="review-filters-row">
          <div className="tabs">
            {REVIEW_DATE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={filters.datePreset === preset ? 'active' : ''}
                onClick={() => setFilters((prev) => ({ ...prev, datePreset: preset }))}
              >
                {reviewDatePresetLabel(t, preset)}
              </button>
            ))}
          </div>
          {showStoreFilter && (
            <label
              className={`review-store-filter${storeFilterNarrowed ? ' is-narrowed' : ''}`}
            >
              {t.common.store}
              <select
                value={filters.storeId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, storeId: e.target.value }))
                }
              >
                <option value="all">{t.common.allStores}</option>
                {selectableStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {filterActive &&
          ((surface === 'reports' && displayReports.length > 0) ||
            (surface === 'logbook' && displayLogbookIssues.length > 0)) && (
            <p className="small review-filter-meta">
              {t.review.showingCount
                .replace('{n}', String(
                  surface === 'reports'
                    ? filteredReports.length
                    : filteredLogbookIssues.length,
                ))
                .replace('{m}', String(
                  surface === 'reports'
                    ? displayReports.length
                    : displayLogbookIssues.length,
                ))}
            </p>
          )}
      </>
    );
  }

  const filtersToggleLabel =
    activeFilterCount > 0
      ? t.review.filtersCount.replace('{n}', String(activeFilterCount))
      : t.review.filters;

  return (
    <div>
      <ReviewFeedbackModal
        open={!!pendingFeedback}
        mode={pendingFeedback?.status ?? 'rejected'}
        itemTitle={pendingFeedback?.response.title ?? ''}
        onConfirm={handleFeedbackConfirm}
        onCancel={() => setPendingFeedback(null)}
      />

      <FinaliseLogbookIssuesModal
        open={!!pendingFinaliseIssues}
        report={pendingFinaliseIssues?.report ?? null}
        items={pendingFinaliseIssues?.items ?? []}
        onConfirm={(result) => void createLogbookIssuesFromFinalise(result)}
        onSkip={() => setPendingFinaliseIssues(null)}
      />

      <div className="card">
        <h1>{t.review.title}</h1>
        <p className="small">{t.review.subtitle}</p>
        <div className="tabs" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={surface === 'reports' ? 'active' : ''}
            onClick={() => setSurface('reports')}
          >
            {t.review.tabReports}
            {displayReports.length > 0 && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                {displayReports.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={surface === 'logbook' ? 'active' : ''}
            onClick={() => setSurface('logbook')}
          >
            {t.review.tabLogbook}
            {displayLogbookIssues.length > 0 && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                {displayLogbookIssues.length}
              </span>
            )}
          </button>
        </div>

        <div className="review-filters">
          <div className="review-filters-trigger-row">
            <button
              type="button"
              className={`secondary review-filters-toggle${filterActive ? ' is-active' : ''}`}
              aria-expanded={reviewFiltersOpen}
              onClick={() => setReviewFiltersOpen((open) => !open)}
            >
              {filtersToggleLabel} {reviewFiltersOpen ? '▴' : '▾'}
            </button>
            {filterActive && (
              <button type="button" className="secondary" onClick={clearAllReviewFilters}>
                {t.review.clearFilters}
              </button>
            )}
          </div>

          {filterActive && !reviewFiltersOpen && (
            <div className="logbook-filter-chips">
              {filterChips.map((chip) => (
                <span key={chip.id} className="logbook-filter-chip">
                  {chip.label}
                  <button
                    type="button"
                    aria-label={t.review.removeFilter}
                    onClick={() =>
                      setFilters((prev) => clearReviewFilterChip(prev, chip.kind))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {reviewFiltersOpen && !isMobileFilters && (
            <div className="review-filters-panel">{renderReviewFiltersBody()}</div>
          )}
        </div>
      </div>

      {reviewFiltersOpen && isMobileFilters && (
        <div
          className="logbook-more-filters-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t.review.filters}
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewFiltersOpen(false);
          }}
        >
          <div className="logbook-more-filters-sheet">
            <div className="logbook-more-filters-sheet-header">
              <strong>{filtersToggleLabel}</strong>
              {filterActive && (
                <button type="button" className="secondary" onClick={clearAllReviewFilters}>
                  {t.review.clearFilters}
                </button>
              )}
            </div>
            {filterActive && (
              <div className="logbook-filter-chips" style={{ padding: '8px 16px 0' }}>
                {filterChips.map((chip) => (
                  <span key={chip.id} className="logbook-filter-chip">
                    {chip.label}
                    <button
                      type="button"
                      aria-label={t.review.removeFilter}
                      onClick={() =>
                        setFilters((prev) => clearReviewFilterChip(prev, chip.kind))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="logbook-more-filters-sheet-body">{renderReviewFiltersBody()}</div>
            <div className="logbook-more-filters-sheet-footer">
              <button type="button" onClick={() => setReviewFiltersOpen(false)}>
                {t.common.done}
              </button>
            </div>
          </div>
        </div>
      )}

      {surface === 'logbook' && logbookRefreshFailed && (
        <p className="small">{t.review.refreshWarning}</p>
      )}

      {surface === 'logbook' &&
        filteredLogbookIssues.map((entry) => {
          const proofType = resolveLogbookProofType(entry);
          const overdue = isIssueOverdue(entry);
          const submitter = resolveActorDisplay(
            entry.resolutionSubmittedByUserId || '',
            undefined,
            displayProfiles,
          );
          const creator = resolveActorDisplay(entry.authorUserId, undefined, displayProfiles);
          const submitterProfile = displayProfiles.find(
            (p) => p.userId === (entry.resolutionSubmittedByUserId || ''),
          );
          const creatorProfile = displayProfiles.find((p) => p.userId === entry.authorUserId);
          const entryEvents = displayEvents.filter((e) => e.logbookEntryId === entry.id);
          const sourceMedia = resolveSourceMedia(entry);
          const resolutionProofs = resolveResolutionProofs(entry);
          const configState = getIssueConfigurationState(entry);
          return (
            <div className="card" key={entry.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, flex: 1 }}>{t.logbook.typeIssue}</h2>
                <span className={badgeClass('waiting_approval')}>
                  {statusLabel(t, 'waiting_approval')}
                </span>
                {overdue && <span className="badge bad">{t.logbook.statusOverdue}</span>}
                <span className="badge">{proofTypeLabel(proofType)}</span>
              </div>
              <p style={{ margin: '8px 0 0' }}>
                <LinkifiedText text={entry.content} standalone="never" />
              </p>
              <p className="small">
                {entry.store?.code || entry.storeId} · {t.common.severity}: {entry.severity} ·{' '}
                {t.logbook.assigneeRole}: {entry.assigneeRole || '—'}
              </p>
              <p className="small">
                {t.review.submittedBy}{' '}
                <IdentityWithAvatar profile={creatorProfile}>{creator}</IdentityWithAvatar>
                {entry.dueAt
                  ? ` · ${t.logbook.dueAt}: ${new Date(entry.dueAt).toLocaleString()}`
                  : ` · ${t.logbook.noDeadline}`}
              </p>
              {configState !== 'ready' && (
                <p className="small" style={{ color: 'var(--warn, #b45309)' }}>
                  {configState === 'missing_assignment'
                    ? t.logbook.configMissingAssignment
                    : configState === 'missing_deadline'
                      ? t.logbook.configMissingDeadline
                      : t.logbook.configMissingRequirement}
                </p>
              )}
              {entry.resolutionRequirement?.trim() && (
                <p className="small">
                  <strong>{t.logbook.resolutionRequirement}:</strong>{' '}
                  <LinkifiedText text={entry.resolutionRequirement} standalone="never" />
                </p>
              )}
              <p className="small">
                {t.logbook.resolvedBySubmitter}:{' '}
                <IdentityWithAvatar profile={submitterProfile}>{submitter}</IdentityWithAvatar>
                {entry.resolutionSubmittedAt
                  ? ` · ${new Date(entry.resolutionSubmittedAt).toLocaleString()}`
                  : ''}
                {entry.resolutionAttemptId
                  ? ` · attempt ${entry.resolutionAttemptId.slice(0, 8)}`
                  : ''}
              </p>
              {entry.resolutionChecked && (
                <p className="small">
                  {t.logbook.resolutionTick}: ✓
                </p>
              )}
              {entry.resolutionNumber && (
                <p className="small">
                  <strong>{t.logbook.resolutionNumber}:</strong> {entry.resolutionNumber}
                </p>
              )}
              {entry.resolutionNote && (
                <p>
                  <strong>{t.common.note}:</strong>{' '}
                  <LinkifiedText text={entry.resolutionNote} standalone="never" />
                </p>
              )}
              {sourceMedia.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">{t.logbook.sourceMedia}</div>
                  {sourceMedia.map((m) => (
                    <ProofPhoto key={m.id} media={{ id: m.id, url: m.url }} />
                  ))}
                </div>
              )}
              {resolutionProofs.current.length + resolutionProofs.history.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">{t.logbook.resolutionProof}</div>
                  {resolutionProofs.current.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div className="small" style={{ marginBottom: 4 }}>
                        {t.logbook.proofLatest}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          overflowX: 'auto',
                          paddingBottom: 4,
                          alignItems: 'flex-start',
                        }}
                      >
                        {resolutionProofs.current.map((m) => (
                          <div key={m.id} style={{ flex: '0 0 auto', minWidth: 120 }}>
                            <ProofPhoto media={{ id: m.id, url: m.url }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {resolutionProofs.history.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="small" style={{ marginBottom: 4 }}>
                        {t.logbook.proofPrevious}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          overflowX: 'auto',
                          paddingBottom: 4,
                          alignItems: 'flex-start',
                        }}
                      >
                        {resolutionProofs.history.map((m) => (
                          <div key={m.id} style={{ flex: '0 0 auto', minWidth: 120 }}>
                            <ProofPhoto media={{ id: m.id, url: m.url }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {entryEvents.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <LogbookTimeline entry={entry} events={entryEvents} />
                </div>
              )}
              <div className="capture-actions" style={{ marginTop: 12 }}>
                <button className="success" type="button" onClick={() => void approveLogbookIssue(entry)}>
                  {t.logbook.approveResolution}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void requestLogbookCorrection(entry)}
                >
                  {t.logbook.requestCorrection}
                </button>
              </div>
            </div>
          );
        })}

      {surface === 'logbook' && !filteredLogbookIssues.length && (
        <div className="card">
          {logbookInitialFailed ? (
            <>
              <p>{logbookBlockingMessage}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => setLogbookQueryPaused(true)}
              >
                {t.common.retry}
              </button>
            </>
          ) : (
            <p>
              {!logbookHasLastGood && logbookLoading
                ? t.common.loading
                : displayLogbookIssues.length > 0 && filterActive
                  ? t.review.noLogbookInFilter
                  : t.review.noLogbookAwaiting}
            </p>
          )}
        </div>
      )}

      {surface === 'reports' && reportsRefreshFailed && (
        <p className="small">{t.review.refreshWarning}</p>
      )}

      {surface === 'reports' &&
        filteredReports.map((report) => {
        const responses = (report.responses ?? []) as ReportResponse[];
        const pendingCount = responses.filter((r) => r.status === 'waiting_approval').length;
        const reportSubmitterName = resolveActorDisplay(
          report.submittedByUserId,
          undefined,
          displayProfiles,
        );
        const reportSubmitterProfile = displayProfiles.find(
          (p) => p.userId === report.submittedByUserId,
        );

        return (
          <div
            className={`card${highlightReportId === report.id ? ' report-card--highlight' : ''}`}
            key={report.id}
            data-report-id={report.id}
            tabIndex={-1}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {report.storeCode} — {report.templateName}
                </h2>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  {report.reportDate} · {t.review.submittedBy}{' '}
                  <IdentityWithAvatar profile={reportSubmitterProfile}>
                    {reportSubmitterName}
                  </IdentityWithAvatar>
                  {report.submittedByRole ? ` (${report.submittedByRole})` : ''} ·{' '}
                  <span className={badgeClass(report.status)}>{statusLabel(t, report.status)}</span> ·{' '}
                  {report.completionPercent ?? 0}% {t.review.percentComplete}
                </p>
              </div>
              {pendingCount > 0 && (
                <span className="badge warn">{pendingCount} {t.review.pendingItems}</span>
              )}
            </div>

            <ReportTimeline
              report={report}
              events={displayEvents.filter((e) => e.reportId === report.id)}
              defaultExpanded
            />

            {responses.map((resp) => {
              const media = (resp.media ?? []) as MediaRecord[];
              const itemSubmitterUserId = resp.submittedByUserId || report.submittedByUserId;
              const itemSubmitterName = resolveActorDisplay(
                itemSubmitterUserId,
                undefined,
                displayProfiles,
              );
              const itemSubmitterProfile = displayProfiles.find(
                (p) => p.userId === itemSubmitterUserId,
              );
              return (
                <div className="item-card" key={resp.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{resp.title}</h3>
                    <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                  </div>
                  <p className="small">
                    By{' '}
                    <IdentityWithAvatar profile={itemSubmitterProfile}>
                      {itemSubmitterName}
                    </IdentityWithAvatar>{' '}
                    · {resp.section} · {resp.proofType}
                  </p>
                  {resp.note && (
                    <p>
                      <strong>{t.common.note}:</strong> {resp.note}
                    </p>
                  )}
                  {resp.numberValue && (
                    <p>
                      <strong>{t.common.number}:</strong> {resp.numberValue}
                    </p>
                  )}
                  {resp.rejectionReason && resp.status !== 'approved' && (
                    <p className="small text-danger" style={{ whiteSpace: 'pre-wrap' }}>
                      {t.review.rejectionReason}: {resp.rejectionReason}
                    </p>
                  )}
                  {media.length > 0 && (
                    <div className="proof-photo-grid">
                      {media.map((m) => (
                        <div className="proof-photo-card" key={m.id}>
                          <ProofPhoto
                            media={m}
                            reviewContext={{
                              storeCode: report.storeCode,
                              itemTitle: resp.title,
                              watermarked: m.watermarked,
                            }}
                          />
                          {isVideoMedia(m.mimeType, m.fileName) && (
                            <ProofMediaDetails media={m} />
                          )}
                          {!isVideoMedia(m.mimeType, m.fileName) && m.photoCode && !m.storageDeleted && (
                            <div className="proof-photo-meta">
                              <span className="proof-photo-code">{m.photoCode}</span>
                              {m.capturedAt && (
                                <span className="proof-photo-time">{formatMediaCaptureTime(m)}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {resp.status === 'waiting_approval' && (
                    <div className="capture-actions" style={{ marginTop: 12 }}>
                      <button
                        className="success"
                        type="button"
                        onClick={() => updateResponseStatus(report, resp, 'approved')}
                      >
                        {t.review.approveItem}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => openFeedbackModal(report, resp, 'rejected')}
                      >
                        {t.review.rejectItem}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => openFeedbackModal(report, resp, 'need_correction')}
                      >
                        {t.review.correction}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {(canFinaliseReportResponses(responses) ||
              canRemindReportInStoreChat(responses)) && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                {canFinaliseReportResponses(responses) ? (
                  <button
                    className="success"
                    type="button"
                    onClick={() => void markReportApproved(report)}
                  >
                    {t.review.finaliseReport}
                  </button>
                ) : null}
                {canRemindReportInStoreChat(responses) ? (
                  <div>
                    <button
                      className="secondary review-remind-chat-btn"
                      type="button"
                      disabled={remindBusyReportId === report.id}
                      onClick={() => void remindReportInStoreChat(report)}
                    >
                      {remindBusyReportId === report.id
                        ? t.review.remindSending
                        : t.review.remindInStoreChat}
                    </button>
                    {remindMsgByReportId[report.id] ? (
                      <p className="small" style={{ margin: '8px 0 0' }}>
                        {remindMsgByReportId[report.id]}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {surface === 'reports' && !filteredReports.length && (
        <div className="card">
          {reportsInitialFailed ? (
            <>
              <p>{reportsBlockingMessage}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setHoldReportsLive(false);
                  lastGoodRichReportsRef.current = [];
                  setReportsQueryPaused(true);
                }}
              >
                {t.common.retry}
              </button>
            </>
          ) : (
            <p>
              {!reportsHasLastGood && reportsLoading
                ? t.common.loading
                : displayReports.length > 0 && filterActive
                  ? t.review.noReportsInFilter
                  : t.review.noAwaitingReview}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
