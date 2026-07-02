import { db } from '../db';
import { badgeClass, nowIso } from '../lib/utils';
import type { Notification } from '../types';

interface Props {
  userId: string;
  title?: string;
  limit?: number;
}

export default function FeedbackInbox({ userId, title = 'Feedback', limit = 15 }: Props) {
  const { data } = db.useQuery({
    notifications: {
      $: { where: { recipientUserId: userId } },
    },
  });

  const all = ((data?.notifications ?? []) as Notification[]).sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
  const notifications = all.slice(0, limit);
  const unreadCount = all.filter((n) => !n.readAt).length;

  async function markRead(n: Notification) {
    if (n.readAt) return;
    await db.transact(db.tx.notifications[n.id].update({ readAt: nowIso() }));
  }

  if (!notifications.length) return null;

  return (
    <div className="card feedback-inbox">
      <div className="feedback-inbox-header">
        <h2 style={{ margin: 0 }}>{title}</h2>
        {unreadCount > 0 && <span className="badge warn">{unreadCount} new</span>}
      </div>

      <div className="feedback-list">
        {notifications.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`feedback-item${n.readAt ? '' : ' feedback-item--unread'}`}
            onClick={() => markRead(n)}
          >
            <div className="feedback-item-top">
              <span className={badgeClass(n.actionStatus)}>{n.actionStatus.replace(/_/g, ' ')}</span>
              <span className="feedback-item-time">{n.createdAt?.slice(0, 16)}</span>
            </div>
            <div className="feedback-item-title">{n.title}</div>
            <div className="feedback-item-stats">
              Completion {n.completionPercent ?? 0}% · Compliance {n.compliancePercent ?? 0}%
            </div>
            <div className="feedback-item-body">{n.body}</div>
            {n.actorRole && (
              <div className="feedback-item-actor">
                Reviewed by {n.actorRole}
                {n.type === 'report_finalized' ? ' · report summary' : ''}
              </div>
            )}
          </button>
        ))}
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
