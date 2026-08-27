import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { badgeClass, nowIso } from '../lib/utils';
import { formatIsoToLocalTime } from '../lib/proofTime';
import {
  isGroupChatMentionNotificationType,
  isLogbookNotificationType,
  markNotificationsReadBatched,
  isStoreChatMentionNotificationType,
} from '../lib/notifications';
import {
  NOTIFICATION_PAGE_SIZE,
  buildOwnUnreadDecrementTxs,
  markAllNotificationsReadViaApi,
  reconcileOwnUnreadCount,
  type UnreadCountRow,
} from '../lib/notificationUnreadCount';
import { useNotificationUnreadCount } from '../hooks/useNotificationUnreadCount';
import ReportTimeline from './ReportTimeline';
import IdentityWithAvatar from './profileAvatar/IdentityWithAvatar';
import { LinkifiedText } from './LinkifiedText';
import type { Notification, Profile, Report, ReviewEvent } from '../types';
import { parseLogbookDeepLinkJson } from '../lib/logbookDeepLink';

export const OPEN_STORE_CHAT_EVENT = 'heyPelo:openStoreChat';
export const OPEN_GROUP_CHAT_EVENT = 'heyPelo:openGroupChat';

export type OpenStoreChatDetail = {
  storeId: string;
  messageId?: string;
  /** When true with messageId, Store Chat enters reply mode after focus. Mention opens omit this. */
  startReply?: boolean;
};

export type OpenGroupChatDetail = {
  roomId: string;
  messageId?: string;
};

function parseGroupChatDeepLink(deepLinkJson: string | undefined): OpenGroupChatDetail | null {
  const raw = String(deepLinkJson ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { kind?: string; roomId?: string; messageId?: string };
    if (parsed?.kind !== 'groupChat') return null;
    const roomId = String(parsed.roomId ?? '').trim();
    if (!roomId) return null;
    const messageId = String(parsed.messageId ?? '').trim();
    return messageId ? { roomId, messageId } : { roomId };
  } catch {
    return null;
  }
}

type InboxMode = 'unread' | 'all';

interface Props {
  userId: string;
  title?: string;
  /** @deprecated Page size is fixed at 15 via Instant infinite query. */
  limit?: number;
  /** When true, wrap in dash-scroll-section (Dashboard only; heading stickiness is owned by the context stack). */
  stickySection?: boolean;
  onOpenLogbookEntry?: (entryId: string, type?: string, deepLinkFilter?: string) => void;
  /** When the parent already loaded these, skip a second Instant reports/events/avatar receive. */
  reports?: Report[];
  events?: ReviewEvent[];
  profileRecords?: Profile[];
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

export default function FeedbackInbox({
  userId,
  title,
  stickySection = false,
  onOpenLogbookEntry,
  reports: parentReports,
  events: parentEvents,
  profileRecords: parentProfiles,
}: Props) {
  const { t } = useLang();
  const inboxTitle = title ?? t.staffHome.feedback;
  const [mode, setMode] = useState<InboxMode>('unread');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMarkingSelected, setIsMarkingSelected] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [optimisticReadAt, setOptimisticReadAt] = useState<Record<string, string>>({});
  const [hiddenUnreadIds, setHiddenUnreadIds] = useState<Set<string>>(new Set());
  const reconciledRef = useRef(false);

  const useParentData =
    parentReports != null && parentEvents != null && parentProfiles != null;

  const { unreadCount, row: unreadRow } = useNotificationUnreadCount(userId);

  const infiniteQuery = useMemo(
    () => ({
      notifications: {
        $: {
          where:
            mode === 'unread'
              ? { recipientUserId: userId, readAt: '' }
              : { recipientUserId: userId },
          order: { createdAt: 'desc' as const },
          limit: NOTIFICATION_PAGE_SIZE,
        },
      },
    }),
    [mode, userId],
  );

  const {
    data: pageData,
    isLoading: listLoading,
    canLoadNextPage,
    loadNextPage,
    error: listError,
  } = db.useInfiniteQuery(infiniteQuery);

  const serverNotifications = useMemo(
    () => dedupeById((pageData?.notifications ?? []) as Notification[]),
    [pageData?.notifications],
  );

  const notifications = useMemo(() => {
    const patched = serverNotifications.map((n) => {
      const opt = optimisticReadAt[n.id];
      if (!opt) return n;
      return { ...n, readAt: n.readAt || opt };
    });
    if (mode === 'unread') {
      return patched.filter((n) => !hiddenUnreadIds.has(n.id) && !n.readAt);
    }
    return patched;
  }, [serverNotifications, optimisticReadAt, hiddenUnreadIds, mode]);

  const reportIdsForSupport = useMemo(() => {
    const ids = new Set<string>();
    for (const n of notifications) {
      if (!n.reportId) continue;
      if (isLogbookNotificationType(n.type)) continue;
      if (isStoreChatMentionNotificationType(n.type)) continue;
      if (isGroupChatMentionNotificationType(n.type)) continue;
      ids.add(n.reportId);
    }
    return [...ids];
  }, [notifications]);

  const actorUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of notifications) {
      if (n.actorUserId) ids.add(n.actorUserId);
    }
    return [...ids];
  }, [notifications]);

  const supportQuery = useMemo(() => {
    if (useParentData) return null;
    const q: {
      reports?: {
        $: { where: { id: { $in: string[] } } };
        responses: Record<string, never>;
      };
      reviewEvents?: {
        $: { where: { reportId: { $in: string[] } } };
      };
      profiles?: {
        $: { where: { userId: { $in: string[] } } };
        avatarFile: Record<string, never>;
      };
    } = {};
    if (reportIdsForSupport.length) {
      q.reports = {
        $: { where: { id: { $in: reportIdsForSupport } } },
        responses: {},
      };
      q.reviewEvents = {
        $: { where: { reportId: { $in: reportIdsForSupport } } },
      };
    }
    if (actorUserIds.length) {
      q.profiles = {
        $: { where: { userId: { $in: actorUserIds } } },
        avatarFile: {},
      };
    }
    return Object.keys(q).length ? q : null;
  }, [useParentData, reportIdsForSupport, actorUserIds]);

  // Instant query typing is strict; cast for dynamic $in support queries.
  const { data: supportData } = db.useQuery(
    supportQuery as Parameters<typeof db.useQuery>[0],
  );

  const support = supportData as
    | {
        reviewEvents?: ReviewEvent[];
        reports?: Report[];
        profiles?: Profile[];
      }
    | undefined;

  const allEvents = (useParentData ? parentEvents : (support?.reviewEvents ?? [])) as ReviewEvent[];
  const allReports = (useParentData ? parentReports : (support?.reports ?? [])) as Report[];
  const profiles = (useParentData ? parentProfiles : (support?.profiles ?? [])) as Profile[];

  const reportById = useMemo(() => {
    const map = new Map<string, Report>();
    for (const r of allReports) map.set(r.id, r);
    return map;
  }, [allReports]);

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

  const notifsByReportId = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of notifications) {
      if (!n.reportId || isLogbookNotificationType(n.type)) continue;
      if (isStoreChatMentionNotificationType(n.type)) continue;
      if (isGroupChatMentionNotificationType(n.type)) continue;
      const list = map.get(n.reportId) ?? [];
      list.push(n);
      map.set(n.reportId, list);
    }
    return map;
  }, [notifications]);

  const loadedUnreadIds = useMemo(
    () => notifications.filter((n) => !n.readAt).map((n) => n.id),
    [notifications],
  );
  const loadedUnreadSet = useMemo(() => new Set(loadedUnreadIds), [loadedUnreadIds]);
  const selectedLoadedUnreadIds = useMemo(
    () => loadedUnreadIds.filter((id) => selectedIds.has(id)),
    [loadedUnreadIds, selectedIds],
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setOptimisticReadAt({});
    setHiddenUnreadIds(new Set());
    setLoadMoreError(false);
    setExpandedReportId(null);
  }, [userId, mode]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (loadedUnreadSet.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [loadedUnreadSet]);

  useEffect(() => {
    if (!userId || reconciledRef.current) return;
    if (unreadRow) {
      reconciledRef.current = true;
      return;
    }
    reconciledRef.current = true;
    void reconcileOwnUnreadCount();
  }, [userId, unreadRow]);

  async function applyMarkRead(targets: Notification[]) {
    const unread = targets.filter((n) => !n.readAt);
    if (!unread.length) return;
    const readAt = nowIso();
    const ids = unread.map((n) => n.id);

    setOptimisticReadAt((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = readAt;
      return next;
    });
    if (mode === 'unread') {
      setHiddenUnreadIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    }

    try {
      const decrementTxs = await buildOwnUnreadDecrementTxs(
        userId,
        unread.length,
        unreadRow as UnreadCountRow | null,
      );
      await markNotificationsReadBatched(unread, {
        readAt,
        transact: async (txs) => {
          const chunks = [
            ...(Array.isArray(txs) ? txs : [txs]),
            ...decrementTxs,
          ] as Parameters<typeof db.transact>[0];
          await db.transact(chunks);
        },
      });
      setSelectedIds((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch {
      setOptimisticReadAt((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      if (mode === 'unread') {
        setHiddenUnreadIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
      throw new Error('mark-read-failed');
    }
  }

  async function markRead(n: Notification) {
    if (n.readAt) return;
    try {
      await applyMarkRead([n]);
    } catch {
      /* optimistic rolled back */
    }
  }

  function toggleTimeline(reportId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedReportId((prev) => (prev === reportId ? null : reportId));
  }

  function openStoreChat(n: Notification) {
    if (!n.storeId || typeof window === 'undefined') return;
    const detail: OpenStoreChatDetail = {
      storeId: n.storeId,
      messageId: n.reportId || undefined,
    };
    window.dispatchEvent(new CustomEvent(OPEN_STORE_CHAT_EVENT, { detail }));
  }

  function openGroupChat(n: Notification) {
    if (typeof window === 'undefined') return;
    const fromLink = parseGroupChatDeepLink(n.deepLinkJson);
    const roomId = fromLink?.roomId?.trim();
    if (!roomId) return;
    const detail: OpenGroupChatDetail = {
      roomId,
      messageId: fromLink?.messageId || n.reportId || undefined,
    };
    window.dispatchEvent(new CustomEvent(OPEN_GROUP_CHAT_EVENT, { detail }));
  }

  function handleClick(n: Notification) {
    void markRead(n);
    if (isStoreChatMentionNotificationType(n.type) && n.storeId) {
      openStoreChat(n);
      return;
    }
    if (isGroupChatMentionNotificationType(n.type)) {
      openGroupChat(n);
      return;
    }
    if (isLogbookNotificationType(n.type) && n.reportId && onOpenLogbookEntry) {
      onOpenLogbookEntry(n.reportId, n.type, parseLogbookDeepLinkJson(n.deepLinkJson)?.filter);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllLoadedUnread() {
    setSelectedIds(new Set(loadedUnreadIds));
  }

  function clearSelected() {
    setSelectedIds(new Set());
  }

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

  async function handleMarkSelectedRead() {
    if (!selectedLoadedUnreadIds.length || isMarkingSelected || isMarkingAll) return;
    setIsMarkingSelected(true);
    try {
      const target = notifications.filter((n) => selectedIds.has(n.id) && !n.readAt);
      await applyMarkRead(target);
      clearSelected();
    } catch {
      /* rolled back */
    } finally {
      setIsMarkingSelected(false);
    }
  }

  async function handleMarkAllRead() {
    if (!unreadCount || isMarkingSelected || isMarkingAll) return;
    const confirmed = window.confirm(
      t.feedback.confirmMarkAllRead.replace('{count}', String(unreadCount)),
    );
    if (!confirmed) return;
    setIsMarkingAll(true);
    try {
      await markAllNotificationsReadViaApi();
      clearSelected();
      setHiddenUnreadIds(new Set(notifications.map((n) => n.id)));
      setOptimisticReadAt({});
    } finally {
      setIsMarkingAll(false);
    }
  }

  const header = (
    <div className="feedback-inbox-header">
      <div className="feedback-inbox-heading">
        <h2
          id="team-feedback-heading"
          data-dash-context=""
          data-dash-level="h2"
          style={{ margin: 0 }}
        >
          {inboxTitle}
        </h2>
        {unreadCount > 0 && (
          <span className="badge warn">
            {unreadCount} {t.common.new}
          </span>
        )}
      </div>
      <div className="feedback-inbox-actions">
        <span className="feedback-inbox-mode" role="group" aria-label={t.feedback.modeLabel}>
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'unread' ? ' is-active' : ''}`}
            aria-pressed={mode === 'unread'}
            onClick={() => setMode('unread')}
          >
            {t.feedback.unreadOnly}
          </button>
          <button
            type="button"
            className={`feedback-inbox-action${mode === 'all' ? ' is-active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            {t.feedback.showAll}
          </button>
        </span>
        {unreadCount > 0 && (
          <>
            <button
              type="button"
              className="feedback-inbox-action"
              onClick={selectAllLoadedUnread}
              disabled={!loadedUnreadIds.length || isMarkingSelected || isMarkingAll}
            >
              {t.common.selectAll}
            </button>
            <button
              type="button"
              className="feedback-inbox-action"
              onClick={clearSelected}
              disabled={!selectedIds.size || isMarkingSelected || isMarkingAll}
            >
              {t.common.clearAll}
            </button>
            <button
              type="button"
              className="feedback-inbox-action"
              onClick={() => void handleMarkSelectedRead()}
              disabled={!selectedLoadedUnreadIds.length || isMarkingSelected || isMarkingAll}
            >
              {isMarkingSelected
                ? `${t.feedback.markSelectedRead}...`
                : t.feedback.markSelectedRead}
            </button>
            <button
              type="button"
              className="feedback-inbox-action"
              onClick={() => void handleMarkAllRead()}
              disabled={isMarkingSelected || isMarkingAll}
            >
              {isMarkingAll ? `${t.feedback.markAllRead}...` : t.feedback.markAllRead}
            </button>
          </>
        )}
      </div>
    </div>
  );

  const listBody = (() => {
    if (listLoading && !notifications.length) {
      return <div className="feedback-list-status">{t.feedback.loading}</div>;
    }
    if (listError && !notifications.length) {
      return (
        <div className="feedback-list-status">
          {t.feedback.loadMoreError}{' '}
          <button type="button" className="feedback-inbox-action" onClick={() => window.location.reload()}>
            {t.feedback.retry}
          </button>
        </div>
      );
    }
    if (!notifications.length) {
      return (
        <div className="feedback-list-status">
          {mode === 'unread' ? t.feedback.emptyUnread : t.feedback.emptyAll}
          {mode === 'unread' && (
            <>
              {' · '}
              <button
                type="button"
                className="feedback-inbox-action"
                onClick={() => setMode('all')}
              >
                {t.feedback.showAll}
              </button>
            </>
          )}
        </div>
      );
    }

    return (
      <>
        <div className="feedback-list-status">
          {t.feedback.showingOf.replace('{shown}', String(notifications.length))}
          {selectedLoadedUnreadIds.length > 0
            ? ` · ${t.common.selectedCount.replace('{count}', String(selectedLoadedUnreadIds.length))}`
            : ''}
        </div>
        {notifications.map((n) => {
          const isLogbook = isLogbookNotificationType(n.type);
          const isStoreChatMention = isStoreChatMentionNotificationType(n.type);
          const isGroupChatMention = isGroupChatMentionNotificationType(n.type);
          const skipReportChrome = isLogbook || isStoreChatMention || isGroupChatMention;
          const report = !skipReportChrome && n.reportId ? reportById.get(n.reportId) : undefined;
          const showTimeline = expandedReportId === n.reportId && report;
          const actorProfile = n.actorUserId
            ? profiles.find((p) => p.userId === n.actorUserId)
            : undefined;
          const actorName =
            actorProfile?.displayName?.trim() ||
            actorProfile?.email?.split('@')[0] ||
            '';

          return (
            <div
              key={n.id}
              className={`feedback-item${n.readAt ? '' : ' feedback-item--unread'}`}
            >
              <div className="feedback-item-row">
                {!n.readAt && (
                  <label
                    className="ui-checkbox-label feedback-item-checkbox"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={selectedIds.has(n.id)}
                      onChange={() => toggleSelected(n.id)}
                      aria-label={n.title}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="feedback-item-main"
                  onClick={() => handleClick(n)}
                >
                  <div className="feedback-item-top">
                    <span className={badgeClass(n.actionStatus)}>{statusLabel(t, n.actionStatus)}</span>
                    <span className="feedback-item-time">{formatIsoToLocalTime(n.createdAt)}</span>
                  </div>
                  <div className="feedback-item-title">{n.title}</div>
                  {(n.actorUserId || n.actorRole) && (
                    <div className="feedback-item-identity">
                      {!isLogbook && <>{t.feedback.reviewedBy}{' '}</>}
                      {actorProfile ? (
                        <span
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <IdentityWithAvatar profile={actorProfile}>
                            {actorName || null}
                          </IdentityWithAvatar>
                        </span>
                      ) : actorName ? (
                        actorName
                      ) : null}
                      {n.actorRole ? (
                        <>
                          {actorProfile || actorName ? ' · ' : ''}
                          {n.actorRole}
                        </>
                      ) : null}
                      {n.type === 'report_finalized' ? ` · ${t.feedback.reportSummary}` : ''}
                    </div>
                  )}
                  {!skipReportChrome && (
                    <div className="feedback-item-stats">
                      {t.feedback.completion} {n.completionPercent ?? 0}% · {t.feedback.compliance}{' '}
                      {n.compliancePercent ?? 0}%
                    </div>
                  )}
                  <div className="feedback-item-body">
                    <LinkifiedText text={n.body} standalone="never" />
                  </div>
                  {isLogbook && onOpenLogbookEntry && n.reportId && (
                    <div className="feedback-item-cta">
                      {t.logbook.openInLogbook}
                    </div>
                  )}
                  {isStoreChatMention && n.storeId && (
                    <div className="feedback-item-cta">Open in Store Chat</div>
                  )}
                  {isGroupChatMention && (
                    <div className="feedback-item-cta">Open in Group Chat</div>
                  )}
                </button>
              </div>
              {n.reportId && report && (
                <div className="feedback-item-timeline">
                  <button
                    type="button"
                    className="report-timeline-toggle"
                    onClick={(e) => toggleTimeline(n.reportId, e)}
                    aria-expanded={!!showTimeline}
                  >
                    {showTimeline ? t.timeline.collapse : t.timeline.expand}
                  </button>
                  {showTimeline && (
                    <ReportTimeline
                      report={report}
                      events={eventsByReportId.get(n.reportId) ?? []}
                      notifications={notifsByReportId.get(n.reportId) ?? []}
                      defaultExpanded
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {(canLoadNextPage || loadMoreError) && (
          <div className="feedback-load-more-wrap">
            {loadMoreError && (
              <div className="feedback-list-status">{t.feedback.loadMoreError}</div>
            )}
            <button
              type="button"
              className="feedback-load-more"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? `${t.feedback.loadMore}...`
                : loadMoreError
                  ? t.feedback.retry
                  : t.feedback.loadMore}
            </button>
          </div>
        )}
      </>
    );
  })();

  const list = <div className="feedback-list">{listBody}</div>;

  if (stickySection) {
    return (
      <section className="dash-scroll-section">
        <div className="dash-section-heading">{header}</div>
        <div className="card feedback-inbox">{list}</div>
      </section>
    );
  }

  return (
    <div className="card feedback-inbox">
      {header}
      {list}
    </div>
  );
}

export { useUnreadNotificationCount } from '../hooks/useNotificationUnreadCount';
