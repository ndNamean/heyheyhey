/**
 * Shared recognition: trusted IP → active wifi IP → store access.
 * No scheduled-shift requirement. Sessions use expiresAt '' = no time expiry
 * (still ends on logout / access / IP / store / network leave / subscription invalidation).
 */

import { getClientPublicIp } from './request-ip.js';
import { findMatchingActiveWifiIp } from './match.js';
import { userHasStoreAccess } from './access.js';
import { isLocationSupplied, verifyStoreGeofence } from './geofence.js';

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
 * Infer activation method for current + legacy sessions.
 * Missing / empty `activationMethod` + non-empty `wifiIpId` → `wifi_ip`.
 * Mirrors `resolveNotificationActivationMethod` in src/types.ts.
 */
export function resolveNotificationActivationMethod(session) {
  const method = String(session?.activationMethod ?? '').trim();
  if (method === 'wifi_ip' || method === 'geofence') return method;
  if (String(session?.wifiIpId ?? '').trim()) return 'wifi_ip';
  return '';
}

/**
 * True when status refresh should end an activation session because presence
 * is not recognized for that session's store (IP or geo). An IP miss alone
 * must not kill a still-valid geofence session when coords were not attempted.
 */
export function shouldDeactivateSessionForNetwork(session, recognition) {
  if (!session) return false;
  if (recognition?.recognized) {
    const sessionStoreId = String(session.storeId || '').trim();
    const recognitionStoreId = String(recognition.store?.id || '').trim();
    if (!sessionStoreId || !recognitionStoreId) return true;
    return sessionStoreId !== recognitionStoreId;
  }
  // Unrecognized: geofence sessions survive IP-only miss (method !== geofence).
  // Geo was attempted when recognition.method === 'geofence'.
  if (
    resolveNotificationActivationMethod(session) === 'geofence' &&
    recognition?.method !== 'geofence'
  ) {
    return false;
  }
  return true;
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

function withPresenceFields(recognition, extra = {}) {
  return {
    ...recognition,
    method: extra.method !== undefined ? extra.method : recognition.method ?? null,
    distanceM: extra.distanceM !== undefined ? extra.distanceM : recognition.distanceM ?? null,
    accuracyM: extra.accuracyM !== undefined ? extra.accuracyM : recognition.accuracyM ?? null,
    geofenceRadiusM:
      extra.geofenceRadiusM !== undefined
        ? extra.geofenceRadiusM
        : recognition.geofenceRadiusM ?? null,
  };
}

/**
 * Geofence-only recognition (no IP match). Loads stores and verifies location.
 * `extras.publicIp` may carry the IP from a prior recognizeStoreWifi attempt.
 */
export async function recognizeStoreGeofence(adminDb, ctx, location, extras = {}) {
  const data = await adminDb.query({
    stores: {},
  });
  const verified = verifyStoreGeofence(location, data.stores ?? [], ctx);
  return withPresenceFields(
    {
      recognized: verified.recognized,
      reason: verified.reason,
      publicIp: extras.publicIp ?? null,
      wifiIp: null,
      store: verified.store,
      shift: null,
      expiresAt: '',
    },
    {
      method: 'geofence',
      distanceM: verified.distanceM,
      accuracyM: verified.accuracyM,
      geofenceRadiusM: verified.geofenceRadiusM,
    },
  );
}

/**
 * IP first, geofence fallback. Keep recognizeStoreWifi return shape intact;
 * this wrapper adds `method` plus optional `distanceM` / `accuracyM`.
 *
 * @param {object} req
 * @param {object} adminDb
 * @param {object} ctx
 * @param {object | null | undefined} [location] `{ latitude, longitude, accuracy }`
 *   (also accepts lat/lng/accuracyM). Omit / empty → do not attempt geofence.
 */
export async function recognizeStorePresence(req, adminDb, ctx, location) {
  const wifi = await recognizeStoreWifi(req, adminDb, ctx);
  if (wifi.recognized) {
    return withPresenceFields(wifi, { method: 'wifi_ip' });
  }
  if (!isLocationSupplied(location)) {
    return withPresenceFields(wifi, { method: null });
  }
  return recognizeStoreGeofence(adminDb, ctx, location, { publicIp: wifi.publicIp });
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
