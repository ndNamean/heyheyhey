/**
 * Pure delivery-gate evaluation for Web Push (no inbox mutation).
 */

import {
  isSessionTimeExpired,
  resolveNotificationActivationMethod,
} from '../wifi-notify/recognize.js';

export { resolveNotificationActivationMethod };

/**
 * @typedef {object} DeliveryContext
 * @property {object} notification
 * @property {object | null} session
 * @property {object | null} subscription
 * @property {object | null} wifiIp
 * @property {object | null} store
 * @property {boolean} hasStoreAccess
 * @property {Date} [now]
 */

/**
 * Evaluate whether a push may be sent for one notification + session.
 * @param {DeliveryContext} ctx
 * @returns {{ allow: boolean, reason: string | null }}
 */
export function evaluateDeliveryGates(ctx) {
  const now = ctx.now ?? new Date();
  const notification = ctx.notification;
  const session = ctx.session;
  const subscription = ctx.subscription;
  const wifiIp = ctx.wifiIp;
  const store = ctx.store;
  const method = resolveNotificationActivationMethod(session || {});

  if (!session) {
    return { allow: false, reason: 'no_active_session' };
  }
  if (String(session.deactivatedAt || '') !== '') {
    return { allow: false, reason: 'no_active_session' };
  }
  if (isSessionTimeExpired(session.expiresAt, now)) {
    return { allow: false, reason: 'session_expired' };
  }
  // Geofence sessions must have a real TTL (empty expiresAt is wifi_ip-only).
  if (method === 'geofence' && !String(session.expiresAt ?? '').trim()) {
    return { allow: false, reason: 'session_expired' };
  }

  if (!notification?.storeId || notification.storeId !== session.storeId) {
    return { allow: false, reason: 'store_mismatch' };
  }

  if (!subscription || String(subscription.revokedAt || '') !== '') {
    return { allow: false, reason: 'subscription_missing' };
  }
  if (session.subscriptionId && subscription.id !== session.subscriptionId) {
    return { allow: false, reason: 'subscription_missing' };
  }
  if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    return { allow: false, reason: 'subscription_missing' };
  }

  if (!store || store.active === false) {
    return { allow: false, reason: 'store_inactive' };
  }

  if (method !== 'geofence') {
    if (!wifiIp || wifiIp.active === false) {
      return { allow: false, reason: 'wifi_ip_inactive' };
    }
    if (session.wifiIpId && wifiIp.id !== session.wifiIpId) {
      return { allow: false, reason: 'wifi_ip_inactive' };
    }
  }

  if (!ctx.hasStoreAccess) {
    return { allow: false, reason: 'store_access_denied' };
  }

  return { allow: true, reason: null };
}

/**
 * Deduplicate notification ids from a request body.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeNotificationIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
