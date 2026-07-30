/**
 * Shared Web Push delivery for inbox notifications.
 * Callable in-process from /api/push/deliver and /api/logbook-notify.
 *
 * Gates (all must pass): active session, unexpired, subscription valid,
 * store/wifi active, recipient store access, storeId match.
 * Never mutates inbox notification rows.
 */

import { id } from '@instantdb/admin';
import { getAdminDb } from '../export/instant-admin.js';
import { loadProfileContext } from '../export/auth.js';
import { userHasStoreAccess } from '../wifi-notify/access.js';
import { evaluateDeliveryGates } from './deliver-gate.js';

function nowIso() {
  return new Date().toISOString();
}

async function trySendWebPush(subscription, payload) {
  try {
    const mod = await import('./web-push-send.js');
    if (typeof mod.sendWebPush === 'function') {
      return await mod.sendWebPush(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh || subscription.keys?.p256dh,
          auth: subscription.auth || subscription.keys?.auth,
        },
        payload,
      );
    }
  } catch (e) {
    return {
      ok: false,
      statusCode: 0,
      reason: 'push_send_unavailable',
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return { ok: false, statusCode: 0, reason: 'push_send_unavailable' };
}

async function logDelivery(adminDb, entry) {
  try {
    await adminDb.transact([
      adminDb.tx.pushDeliveryLogs[id()].update({
        notificationId: entry.notificationId || '',
        userId: entry.userId || '',
        deviceId: entry.deviceId || '',
        outcome: entry.outcome || 'suppressed',
        reason: entry.reason || '',
        createdAt: nowIso(),
      }),
    ]);
  } catch {
    /* optional entity / perms — ignore */
  }
}

async function revokeSubscriptionAndSessions(adminDb, subscription, reason) {
  const now = nowIso();
  const txs = [];
  if (subscription?.id) {
    txs.push(
      adminDb.tx.pushSubscriptions[subscription.id].update({
        revokedAt: now,
        updatedAt: now,
      }),
    );
  }
  const sessions = await adminDb.query({
    notificationActivationSessions: {
      $: {
        where: {
          subscriptionId: subscription?.id || '__none__',
          deactivatedAt: '',
        },
      },
    },
  });
  for (const session of sessions.notificationActivationSessions ?? []) {
    txs.push(
      adminDb.tx.notificationActivationSessions[session.id].update({
        deactivatedAt: now,
        deactivateReason: reason || 'subscription_removed',
      }),
    );
  }
  if (txs.length) {
    try {
      await adminDb.transact(txs);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * @param {string[]} notificationIds
 * @param {{ adminDb?: import('@instantdb/admin').InstantAdminDatabase }} [opts]
 * @returns {Promise<{ results: Array<{ notificationId: string, outcome: string, reason?: string }> }>}
 */
export async function deliverPushForNotificationIds(notificationIds, opts = {}) {
  const ids = [...new Set((notificationIds || []).filter((x) => typeof x === 'string' && x.trim()))];
  const results = [];
  if (!ids.length) return { results };

  const adminDb = opts.adminDb || getAdminDb();
  const now = Date.now();
  const nowIsoStr = nowIso();

  let notifications = [];
  try {
    const q = await adminDb.query({
      notifications: {
        $: { where: { id: { $in: ids } } },
      },
    });
    notifications = q.notifications ?? [];
  } catch (e) {
    // Fallback: query one-by-one if $in unsupported
    for (const nid of ids) {
      try {
        const q = await adminDb.query({
          notifications: { $: { where: { id: nid } } },
        });
        if (q.notifications?.[0]) notifications.push(q.notifications[0]);
      } catch {
        /* skip */
      }
    }
  }

  const byId = new Map(notifications.map((n) => [n.id, n]));

  for (const notificationId of ids) {
    const notif = byId.get(notificationId);
    if (!notif) {
      results.push({ notificationId, outcome: 'suppressed', reason: 'notification_missing' });
      continue;
    }

    const recipientUserId = notif.recipientUserId;
    const storeId = notif.storeId || '';

    if (!recipientUserId) {
      results.push({ notificationId, outcome: 'suppressed', reason: 'no_recipient' });
      continue;
    }

    let sessions = [];
    try {
      const sq = await adminDb.query({
        notificationActivationSessions: {
          $: {
            where: {
              userId: recipientUserId,
              deactivatedAt: '',
            },
          },
        },
      });
      sessions = (sq.notificationActivationSessions ?? []).filter((s) => {
        if (storeId && s.storeId && s.storeId !== storeId) return false;
        const exp = Date.parse(s.expiresAt);
        return Number.isFinite(exp) && exp > now;
      });
    } catch {
      sessions = [];
    }

    if (!sessions.length) {
      results.push({ notificationId, outcome: 'suppressed', reason: 'no_active_session' });
      await logDelivery(adminDb, {
        notificationId,
        userId: recipientUserId,
        deviceId: '',
        outcome: 'suppressed',
        reason: 'no_active_session',
      });
      continue;
    }

    let recipientCtx;
    try {
      recipientCtx = await loadProfileContext(recipientUserId);
    } catch {
      results.push({ notificationId, outcome: 'suppressed', reason: 'store_access_denied' });
      continue;
    }

    let anySent = false;
    let lastSuppressReason = 'no_active_session';
    const hasAccess = storeId
      ? userHasStoreAccess(recipientCtx, storeId)
      : true;

    for (const session of sessions) {
      let store = null;
      let wifiIp = null;
      let subscription = null;
      try {
        const meta = await adminDb.query({
          stores: { $: { where: { id: session.storeId } } },
          storeWifiIps: { $: { where: { id: session.wifiIpId } } },
          pushSubscriptions: {
            $: { where: { id: session.subscriptionId } },
          },
        });
        store = meta.stores?.[0] ?? null;
        wifiIp = meta.storeWifiIps?.[0] ?? null;
        subscription = meta.pushSubscriptions?.[0] ?? null;
      } catch {
        /* treat as missing below */
      }

      const gate = evaluateDeliveryGates({
        notification: notif,
        session,
        subscription,
        wifiIp,
        store,
        hasStoreAccess: hasAccess,
        now: new Date(now),
      });

      if (!gate.allow) {
        lastSuppressReason = gate.reason || 'no_active_session';
        await logDelivery(adminDb, {
          notificationId,
          userId: recipientUserId,
          deviceId: session.deviceId,
          outcome: 'suppressed',
          reason: lastSuppressReason,
        });
        continue;
      }

      const payload = {
        title: notif.title || 'Hey Pelo Ops',
        body: notif.body || '',
        url: '/',
      };

      const sendResult = await trySendWebPush(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        payload,
      );

      if (sendResult?.ok) {
        anySent = true;
        await logDelivery(adminDb, {
          notificationId,
          userId: recipientUserId,
          deviceId: session.deviceId,
          outcome: 'sent',
          reason: '',
        });
        continue;
      }

      const statusCode = sendResult?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await revokeSubscriptionAndSessions(adminDb, subscription, 'subscription_removed');
      }

      lastSuppressReason = sendResult?.reason || sendResult?.error || 'push_send_failed';
      await logDelivery(adminDb, {
        notificationId,
        userId: recipientUserId,
        deviceId: session.deviceId,
        outcome: 'suppressed',
        reason: lastSuppressReason,
      });
    }

    results.push({
      notificationId,
      outcome: anySent ? 'sent' : 'suppressed',
      reason: anySent ? undefined : lastSuppressReason,
      at: nowIsoStr,
    });
  }

  return { results };
}
