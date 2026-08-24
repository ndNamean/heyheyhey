import { useEffect, useMemo, useState } from 'react';
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

interface Props {
  userId: string;
  title?: string;
  limit?: number;
  /** When true, wrap in dash-scroll-section (Dashboard only; heading stickiness is owned by the context stack). */
  stickySection?: boolean;
  onOpenLogbookEntry?: (entryId: string, type?: string, deepLinkFilter?: string) => void;
  /** When the parent already loaded these, skip a second Instant reports/events/avatar receive. */
  reports?: Report[];
  events?: ReviewEvent[];
  profileRecords?: Profile[];
}

const WINDOW_SIZE = 30;
const LOAD_MORE_THRESHOLD_PX = 80;

export default function FeedbackInbox({
  userId,
  title,
  limit = 15,
  stickySection = false,
  onOpenLogbookEntry,
  reports: parentReports,
  events: parentEvents,
  profileRecords: parentProfiles,
}: Props) {
  const { t } = useLang();
  const inboxTitle = title ?? t.staffHome.feedback;
  const initialVisibleCount = Math.max(WINDOW_SIZE, limit);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMarkingSelected, setIsMarkingSelected] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const useParentData =
    parentReports != null && parentEvents != null && parentProfiles != null;

  const inboxQuery = useMemo(
    () =>
      useParentData
        ? {
            notifications: {
              $: { where: { recipientUserId: userId } },
            },
          }
        : {
            notifications: {
              $: { where: { recipientUserId: userId } },
            },
            reviewEvents: {},
            reports: { responses: {} },
            profiles: { avatarFile: {} },
          },
    [useParentData, userId],
  );

  const { data } = db.useQuery(inboxQuery);

  const all = ((data?.notifications ?? []) as Notification[]).sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
  const notifications = all.slice(0, visibleCount);
  const unreadCount = all.filter((n) => !n.readAt).length;
  const loadedUnreadIds = useMemo(
    () => notifications.filter((n) => !n.readAt).map((n) => n.id),
    [notifications],
  );
  const loadedUnreadSet = useMemo(() => new Set(loadedUnreadIds), [loadedUnreadIds]);
  const selectedLoadedUnreadIds = useMemo(
    () => loadedUnreadIds.filter((id) => selectedIds.has(id)),
    [loadedUnreadIds, selectedIds],
  );
  const hasMore = visibleCount < all.length;

  const allEvents = (useParentData ? parentEvents : (data?.reviewEvents ?? [])) as ReviewEvent[];
  const allReports = (useParentData ? parentReports : (data?.reports ?? [])) as Report[];
  const profiles = (useParentData ? parentProfiles : (data?.profiles ?? [])) as Profile[];

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
    for (const n of all) {
      if (!n.reportId || isLogbookNotificationType(n.type)) continue;
      if (isStoreChatMentionNotificationType(n.type)) continue;
      if (isGroupChatMentionNotificationType(n.type)) continue;
      const list = map.get(n.reportId) ?? [];
      list.push(n);
      map.set(n.reportId, list);
    }
    return map;
  }, [all]);

  async function markRead(n: Notification) {
    if (n.readAt) return;
    await db.transact(db.tx.notifications[n.id].update({ readAt: nowIso() }));
  }

  useEffect(() => {
    setVisibleCount(initialVisibleCount);
    setSelectedIds(new Set());
  }, [userId, initialVisibleCount]);

  useEffect(() => {
    setVisibleCount((prev) => Math.min(Math.max(prev, initialVisibleCount), all.length || initialVisibleCount));
  }, [all.length, initialVisibleCount]);

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

  function showMore() {
    setVisibleCount((prev) => Math.min(prev + WINDOW_SIZE, all.length));
  }

  async function handleMarkSelectedRead() {
    if (!selectedLoadedUnreadIds.length || isMarkingSelected || isMarkingAll) return;
    setIsMarkingSelected(true);
    try {
      const target = all.filter((n) => selectedIds.has(n.id) && !n.readAt);
      await markNotificationsReadBatched(target);
      clearSelected();
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
      await markNotificationsReadBatched(all);
      clearSelected();
    } finally {
      setIsMarkingAll(false);
    }
  }

  function handleListScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!hasMore) return;
    const node = e.currentTarget;
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (remaining <= LOAD_MORE_THRESHOLD_PX) showMore();
  }

  if (!notifications.length) return null;

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
          disabled={!unreadCount || isMarkingSelected || isMarkingAll}
        >
          {isMarkingAll ? `${t.feedback.markAllRead}...` : t.feedback.markAllRead}
        </button>
      </div>
    </div>
  );

  const list = (
    <div className="feedback-list" onScroll={handleListScroll}>
      <div className="feedback-list-status">
        {t.feedback.showingOf
          .replace('{shown}', String(notifications.length))
          .replace('{total}', String(all.length))}
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
      {hasMore && (
        <button type="button" className="feedback-load-more" onClick={showMore}>
          {t.feedback.loadMore}
        </button>
      )}
    </div>
  );

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

export function useUnreadNotificationCount(userId: string): number {
  const { data } = db.useQuery({
    notifications: {
      $: { where: { recipientUserId: userId } },
    },
  });
  return ((data?.notifications ?? []) as Notification[]).filter((n) => !n.readAt).length;
}
