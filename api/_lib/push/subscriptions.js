/**
 * Push subscription upsert / revoke helpers (Admin SDK).
 */

import { id } from '@instantdb/admin';

function nowIso() {
  return new Date().toISOString();
}

export function parseSubscriptionPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = String(raw.endpoint || '').trim();
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : raw;
  const p256dh = String(keys.p256dh || keys.p256DH || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  if (!/^https:\/\//i.test(endpoint)) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Upsert an active push subscription for user+device (by endpoint uniqueness).
 * @returns {{ subscriptionId: string, created: boolean }}
 */
export async function upsertPushSubscription(adminDb, {
  userId,
  deviceId,
  endpoint,
  p256dh,
  auth,
  userAgent = '',
}) {
  const now = nowIso();
  const byEndpoint = await adminDb.query({
    pushSubscriptions: {
      $: { where: { endpoint } },
    },
  });
  const existing = byEndpoint.pushSubscriptions?.[0];

  if (existing) {
    await adminDb.transact(
      adminDb.tx.pushSubscriptions[existing.id].update({
        userId,
        deviceId,
        p256dh,
        auth,
        userAgent: userAgent || existing.userAgent || '',
        updatedAt: now,
        revokedAt: '',
      }),
    );
    return { subscriptionId: existing.id, created: false };
  }

  // Also clear any other active rows for this user+device (one active endpoint per device).
  const byDevice = await adminDb.query({
    pushSubscriptions: {
      $: { where: { userId, deviceId } },
    },
  });
  const txs = [];
  for (const row of byDevice.pushSubscriptions ?? []) {
    if (String(row.revokedAt || '') === '') {
      txs.push(
        adminDb.tx.pushSubscriptions[row.id].update({
          revokedAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  const subscriptionId = id();
  txs.push(
    adminDb.tx.pushSubscriptions[subscriptionId].update({
      userId,
      deviceId,
      endpoint,
      p256dh,
      auth,
      userAgent: userAgent || '',
      createdAt: now,
      updatedAt: now,
      revokedAt: '',
    }),
  );
  await adminDb.transact(txs);
  return { subscriptionId, created: true };
}

export async function revokePushSubscription(adminDb, subscription, reasonNow = nowIso()) {
  if (!subscription?.id) return;
  if (String(subscription.revokedAt || '') !== '') return;
  await adminDb.transact(
    adminDb.tx.pushSubscriptions[subscription.id].update({
      revokedAt: reasonNow,
      updatedAt: reasonNow,
    }),
  );
}

/**
 * Deactivate active notification sessions matching a filter.
 */
export async function deactivateSessions(adminDb, sessions, reason) {
  const now = nowIso();
  const active = (sessions ?? []).filter((s) => s && String(s.deactivatedAt || '') === '');
  if (!active.length) return 0;
  await adminDb.transact(
    active.map((s) =>
      adminDb.tx.notificationActivationSessions[s.id].update({
        deactivatedAt: now,
        deactivateReason: reason || 'subscription_removed',
      }),
    ),
  );
  return active.length;
}

export async function findSubscriptionForDevice(adminDb, userId, deviceId) {
  const result = await adminDb.query({
    pushSubscriptions: {
      $: { where: { userId, deviceId } },
    },
  });
  const rows = result.pushSubscriptions ?? [];
  return (
    rows.find((r) => String(r.revokedAt || '') === '') ||
    null
  );
}

export async function findSubscriptionById(adminDb, subscriptionId) {
  if (!subscriptionId) return null;
  const result = await adminDb.query({
    pushSubscriptions: {
      $: { where: { id: subscriptionId } },
    },
  });
  return result.pushSubscriptions?.[0] ?? null;
}
