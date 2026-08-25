/**
 * Extract notification entity ids from Instant transaction chunks and
 * fire-and-forget Web Push delivery. Inbox writes always win.
 */

import { requestPushDelivery } from './pushClient';

export function extractNotificationIdsFromTxs(txs: unknown[]): string[] {
  const ids: string[] = [];
  for (const chunk of txs) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ops = (chunk as { __ops?: unknown }).__ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (!Array.isArray(op) || op.length < 3) continue;
      const [cmd, etype, entityId] = op;
      if (
        (cmd === 'update' || cmd === 'merge' || cmd === 'create') &&
        etype === 'notifications' &&
        typeof entityId === 'string' &&
        entityId.trim()
      ) {
        ids.push(entityId);
      }
    }
  }
  return [...new Set(ids)];
}

/** After successful db.transact of notification txs — never throws to caller. */
export function schedulePushDeliveryFromTxs(txs: unknown[]): void {
  const ids = extractNotificationIdsFromTxs(txs);
  if (ids.length) void requestPushDelivery(ids);
  // Lazy import avoids pulling Instant client into node unit tests.
  void import('./notificationUnreadCount')
    .then(({ scheduleUnreadCountBumpFromTxs }) => {
      scheduleUnreadCountBumpFromTxs(txs);
    })
    .catch(() => {
      /* badge drift fixed by reconcile */
    });
}

export function schedulePushDelivery(notificationIds: string[]): void {
  if (!notificationIds.length) return;
  void requestPushDelivery(notificationIds);
}
