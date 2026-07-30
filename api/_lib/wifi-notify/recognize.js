/**
 * Shared recognition: trusted IP → active wifi IP → store access.
 * No scheduled-shift requirement. Sessions use expiresAt '' = no time expiry
 * (still ends on logout / access / IP / store / subscription invalidation).
 */

import { getClientPublicIp } from './request-ip.js';
import { findMatchingActiveWifiIp } from './match.js';
import { userHasStoreAccess } from './access.js';

/**
 * True when a session should be treated as time-expired.
 * Empty / missing expiresAt means no time-based expiry.
 */
export function isSessionTimeExpired(expiresAt, now = new Date()) {
  const raw = String(expiresAt ?? '').trim();
  if (!raw) return false;
  const exp = Date.parse(raw);
  if (!Number.isFinite(exp)) return false;
  return exp <= now.getTime();
}

/**
 * Load wifi + stores and evaluate recognition for the request IP.
 */
export async function recognizeStoreWifi(req, adminDb, ctx) {
  const publicIp = getClientPublicIp(req);
  if (!publicIp) {
    return {
      recognized: false,
      reason: 'no_public_ip',
      publicIp: null,
      wifiIp: null,
      store: null,
      shift: null,
      expiresAt: '',
    };
  }

  const data = await adminDb.query({
    storeWifiIps: {
      $: { where: { active: true } },
    },
    stores: {},
  });

  const wifiIps = data.storeWifiIps ?? [];
  const storesById = new Map((data.stores ?? []).map((s) => [s.id, s]));
  const match = findMatchingActiveWifiIp(publicIp, wifiIps, storesById);

  if (!match) {
    return {
      recognized: false,
      reason: 'ip_unrecognized',
      publicIp,
      wifiIp: null,
      store: null,
      shift: null,
      expiresAt: '',
    };
  }

  const store = match.store ?? storesById.get(match.wifiIp.storeId) ?? null;
  if (!store || store.active === false) {
    return {
      recognized: false,
      reason: 'store_inactive',
      publicIp,
      wifiIp: match.wifiIp,
      store,
      shift: null,
      expiresAt: '',
    };
  }

  if (!userHasStoreAccess(ctx, store.id)) {
    return {
      recognized: false,
      reason: 'no_store_access',
      publicIp,
      wifiIp: match.wifiIp,
      store,
      shift: null,
      expiresAt: '',
    };
  }

  return {
    recognized: true,
    reason: null,
    publicIp,
    wifiIp: match.wifiIp,
    store,
    shift: null,
    expiresAt: '',
  };
}

/**
 * Load active (non-deactivated, non-time-expired) activation sessions for a user+device.
 */
export async function loadActiveSessions(adminDb, userId, deviceId, now = new Date()) {
  const result = await adminDb.query({
    notificationActivationSessions: {
      $: {
        where: {
          userId,
          deviceId,
        },
      },
    },
  });
  return (result.notificationActivationSessions ?? []).filter((s) => {
    if (!s) return false;
    if (String(s.deactivatedAt || '') !== '') return false;
    if (isSessionTimeExpired(s.expiresAt, now)) return false;
    return true;
  });
}
