import { useMemo, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { badgeClass, nowIso } from '../lib/utils';
import { formatIsoToLocalTime } from '../lib/proofTime';
import { isLogbookNotificationType } from '../lib/notifications';
import ReportTimeline from './ReportTimeline';
import type { Notification, Report, ReviewEvent } from '../types';

interface Props {
  userId: string;
  title?: string;
  limit?: number;
  onOpenLogbookEntry?: (entryId: string) => void;
}

export default function FeedbackInbox({
  userId,
  title,
  limit = 15,
  onOpenLogbookEntry,
}: Props) {
  const { t } = useLang();
  const inboxTitle = title ?? t.staffHome.feedback;
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  const { data } = db.useQuery({
    notifications: {
      $: { where: { recipientUserId: userId } },
    },
    reviewEvents: {},
    reports: { responses: {} },
  });

  const all = ((data?.notifications ?? []) as Notification[]).sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
  const notifications = all.slice(0, limit);
  const unreadCount = all.filter((n) => !n.readAt).length;

  const allEvents = (data?.reviewEvents ?? []) as ReviewEvent[];
  const allReports = (data?.reports ?? []) as Report[];

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

  function toggleTimeline(reportId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedReportId((prev) => (prev === reportId ? null : reportId));
  }

  function handleClick(n: Notification) {
    void markRead(n);
    if (isLogbookNotificationType(n.type) && n.reportId && onOpenLogbookEntry) {
      onOpenLogbookEntry(n.reportId);
    }
  }

  if (!notifications.length) return null;

  return (
    <div className="card feedback-inbox">
      <div className="feedback-inbox-header">
        <h2 style={{ margin: 0 }}>{inboxTitle}</h2>
        {unreadCount > 0 && (
          <span className="badge warn">
            {unreadCount} {t.common.new}
          </span>
        )}
      </div>

      <div className="feedback-list">
        {notifications.map((n) => {
          const isLogbook = isLogbookNotificationType(n.type);
          const report = !isLogbook && n.reportId ? reportById.get(n.reportId) : undefined;
          const showTimeline = expandedReportId === n.reportId && report;

          return (
            <button
              key={n.id}
              type="button"
              className={`feedback-item${n.readAt ? '' : ' feedback-item--unread'}`}
              onClick={() => handleClick(n)}
            >
              <div className="feedback-item-top">
                <span className={badgeClass(n.actionStatus)}>{statusLabel(t, n.actionStatus)}</span>
                <span className="feedback-item-time">{formatIsoToLocalTime(n.createdAt)}</span>
              </div>
              <div className="feedback-item-title">{n.title}</div>
              {!isLogbook && (
                <div className="feedback-item-stats">
                  {t.feedback.completion} {n.completionPercent ?? 0}% · {t.feedback.compliance}{' '}
                  {n.compliancePercent ?? 0}%
                </div>
              )}
              <div className="feedback-item-body">{n.body}</div>
              {n.actorRole && (
                <div className="feedback-item-actor">
                  {t.feedback.reviewedBy} {n.actorRole}
                  {n.type === 'report_finalized' ? ` · ${t.feedback.reportSummary}` : ''}
                </div>
              )}
              {isLogbook && onOpenLogbookEntry && n.reportId && (
                <div className="feedback-item-actor">{t.logbook.openInLogbook}</div>
              )}
              {n.reportId && report && (
                <div className="feedback-item-timeline" onClick={(e) => e.stopPropagation()}>
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
            </button>
          );
        })}
      </div>
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
