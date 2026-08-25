import { db } from '../db';
import type { NotificationUnreadCount } from '../types';

/**
 * Subscribe to the per-user unread notification counter (badge).
 * Does not scan the notifications collection.
 */
export function useNotificationUnreadCount(userId: string): {
  unreadCount: number;
  row: NotificationUnreadCount | null;
  isLoading: boolean;
} {
  const { data, isLoading } = db.useQuery(
    userId
      ? {
          notificationUnreadCounts: {
            $: { where: { userId } },
          },
        }
      : null,
  );
  const row = ((data?.notificationUnreadCounts ?? [])[0] ?? null) as NotificationUnreadCount | null;
  const unreadCount =
    row && typeof row.unreadCount === 'number' && Number.isFinite(row.unreadCount)
      ? Math.max(0, Math.floor(row.unreadCount))
      : 0;
  return { unreadCount, row, isLoading: Boolean(userId) && Boolean(isLoading) };
}

/** Nav badge helper — same counter, number only. */
export function useUnreadNotificationCount(userId: string): number {
  return useNotificationUnreadCount(userId).unreadCount;
}
