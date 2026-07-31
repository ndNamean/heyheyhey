/**
 * Flush phone pushes for unread, never-sent inbox rows when Wi‑Fi activates.
 * Does not mutate notification rows; reuses deliverPushForNotificationIds gates.
 */

import { deliverPushForNotificationIds } from './deliver-notifications.js';

export const PENDING_PUSH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_PUSH_MAX = 50;

/**
 * Pure selection: unread + never successfully pushed + within max age, oldest first, capped.
 *
 * @param {Array<{ id: string, readAt?: string, storeId?: string, recipientUserId?: string, createdAt?: string }>} notifications
 * @param {Set<string> | string[]} alreadySentIds
 * @param {{ userId: string, storeId: string, now?: number | Date, maxAgeMs?: number, maxCount?: number }} opts
 * @returns {string[]}
 */
export function selectPendingPushNotificationIds(notifications, alreadySentIds, opts) {
  const userId = opts?.userId;
  const storeId = opts?.storeId;
  if (!userId || !storeId) return [];

  const sent =
    alreadySentIds instanceof Set
      ? alreadySentIds
      : new Set(Array.isArray(alreadySentIds) ? alreadySentIds : []);
  const nowMs =
    opts.now instanceof Date
      ? opts.now.getTime()
      : typeof opts.now === 'number'
        ? opts.now
        : Date.now();
  const maxAgeMs =
    typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : PENDING_PUSH_MAX_AGE_MS;
  const maxCount =
    typeof opts.maxCount === 'number' ? opts.maxCount : PENDING_PUSH_MAX;
  const cutoff = nowMs - maxAgeMs;

  const eligible = [];
  for (const n of notifications || []) {
    if (!n?.id) continue;
    if (n.recipientUserId !== userId) continue;
    if (n.storeId !== storeId) continue;
    if (String(n.readAt ?? '') !== '') continue;
    if (sent.has(n.id)) continue;
    const createdMs = Date.parse(String(n.createdAt ?? ''));
    if (!Number.isFinite(createdMs) || createdMs < cutoff) continue;
    eligible.push({ id: n.id, createdMs });
  }

  eligible.sort((a, b) => a.createdMs - b.createdMs);
  return eligible.slice(0, Math.max(0, maxCount)).map((x) => x.id);
}

/**
 * @param {{ adminDb: object, userId: string, storeId: string, now?: Date }} args
 * @returns {Promise<{ notificationIds: string[], results: Array<object> }>}
 */
export async function flushPendingPushesForSession({ adminDb, userId, storeId, now } = {}) {
  const uid = String(userId || '').trim();
  const sid = String(storeId || '').trim();
  if (!adminDb || !uid || !sid) {
    return { notificationIds: [], results: [] };
  }

  let notifications = [];
  try {
    const q = await adminDb.query({
      notifications: {
        $: {
          where: {
            recipientUserId: uid,
            storeId: sid,
            readAt: '',
          },
        },
      },
    });
    notifications = q.notifications ?? [];
  } catch {
    return { notificationIds: [], results: [] };
  }

  const candidateIds = notifications.map((n) => n.id).filter(Boolean);
  const alreadySentIds = new Set();
  if (candidateIds.length) {
    try {
      const logsQ = await adminDb.query({
        pushDeliveryLogs: {
          $: { where: { notificationId: { $in: candidateIds } } },
        },
      });
      for (const log of logsQ.pushDeliveryLogs ?? []) {
        if (log?.outcome === 'sent' && log.notificationId) {
          alreadySentIds.add(log.notificationId);
        }
      }
    } catch {
      for (const nid of candidateIds) {
        try {
          const logsQ = await adminDb.query({
            pushDeliveryLogs: {
              $: { where: { notificationId: nid } },
            },
          });
          if ((logsQ.pushDeliveryLogs ?? []).some((log) => log?.outcome === 'sent')) {
            alreadySentIds.add(nid);
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  const notificationIds = selectPendingPushNotificationIds(notifications, alreadySentIds, {
    userId: uid,
    storeId: sid,
    now: now ?? new Date(),
  });

  if (!notificationIds.length) {
    return { notificationIds: [], results: [] };
  }

  const { results } = await deliverPushForNotificationIds(notificationIds, { adminDb });
  return { notificationIds, results: results ?? [] };
}
