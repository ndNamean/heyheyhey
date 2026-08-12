/**
 * Pure store-geofence verifier. Never trust client insideStore / recognized flags.
 */

import { userHasStoreAccess } from './access.js';
import { haversine, MAX_LOCATION_ACCURACY_M } from './geo-math.js';

/** Min gap (m) between the two nearest passing stores before we call it unambiguous. */
export const AMBIGUOUS_STORE_MIN_GAP_M = 25;

export {
  haversine,
  MAX_LOCATION_ACCURACY_M,
  GEO_PRESENCE_TTL_MS,
  geofenceExpiresAtIso,
} from './geo-math.js';

function isAbsent(value) {
  return value == null || value === '';
}

function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function resolveHasStoreAccess(access) {
  if (typeof access === 'function') return access;
  if (access && typeof access === 'object') {
    return (storeId) => userHasStoreAccess(access, storeId);
  }
  return () => false;
}

/**
 * True when a location payload was actually provided (any lat/lng/accuracy field).
 * Empty / omitted → caller should keep the IP recognition reason.
 */
export function isLocationSupplied(location) {
  if (location == null || typeof location !== 'object' || Array.isArray(location)) {
    return false;
  }
  const lat = location.latitude ?? location.lat;
  const lng = location.longitude ?? location.lng;
  const acc = location.accuracy ?? location.accuracyM;
  return !isAbsent(lat) || !isAbsent(lng) || !isAbsent(acc);
}

/**
 * Parse client lat/lng/accuracy. Accepts Geolocation names or lat/lng/accuracyM.
 * @returns {{ ok: true, latitude: number, longitude: number, accuracyM: number } | { ok: false, reason: 'malformed_location' }}
 */
export function parseDeviceLocation(location) {
  if (location == null || typeof location !== 'object' || Array.isArray(location)) {
    return { ok: false, reason: 'malformed_location' };
  }
  const latitude = toFiniteNumber(location.latitude ?? location.lat);
  const longitude = toFiniteNumber(location.longitude ?? location.lng);
  const accuracyM = toFiniteNumber(location.accuracy ?? location.accuracyM);
  if (latitude == null || longitude == null || accuracyM == null) {
    return { ok: false, reason: 'malformed_location' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ok: false, reason: 'malformed_location' };
  }
  if (accuracyM < 0) {
    return { ok: false, reason: 'malformed_location' };
  }
  return { ok: true, latitude, longitude, accuracyM };
}

function eligibleGeofenceStores(stores, hasStoreAccess) {
  const out = [];
  for (const store of stores ?? []) {
    if (!store?.id) continue;
    if (store.active === false) continue;
    if (!hasStoreAccess(String(store.id))) continue;
    const lat = toFiniteNumber(store.lat);
    const lng = toFiniteNumber(store.lng);
    const radius = toFiniteNumber(store.geofenceRadiusM);
    if (lat == null || lng == null || radius == null || radius <= 0) continue;
    out.push({ store, lat, lng, radius });
  }
  return out;
}

function unrecognized(reason, extra = {}) {
  return {
    recognized: false,
    reason,
    store: null,
    method: 'geofence',
    distanceM: extra.distanceM ?? null,
    accuracyM: extra.accuracyM ?? null,
    geofenceRadiusM: extra.geofenceRadiusM ?? null,
  };
}

/**
 * Server-side geofence check. Ignores client insideStore / recognized.
 *
 * @param {object} location
 * @param {Array} stores
 * @param {((storeId: string) => boolean) | object} hasStoreAccessOrCtx
 *   Access callback, or a wifi-notify ctx object (userHasStoreAccess).
 *   Missing / invalid → fail closed (no access).
 */
export function verifyStoreGeofence(location, stores, hasStoreAccessOrCtx) {
  const parsed = parseDeviceLocation(location);
  if (!parsed.ok) {
    return unrecognized('malformed_location');
  }

  const { latitude, longitude, accuracyM } = parsed;
  const hasAccess = resolveHasStoreAccess(hasStoreAccessOrCtx);
  const candidates = eligibleGeofenceStores(stores, hasAccess).map((row) => ({
    ...row,
    distanceM: haversine(latitude, longitude, row.lat, row.lng),
  }));
  candidates.sort((a, b) => a.distanceM - b.distanceM);

  const nearest = candidates[0] ?? null;

  if (accuracyM > MAX_LOCATION_ACCURACY_M) {
    return unrecognized('location_inaccurate', {
      accuracyM,
      distanceM: nearest ? nearest.distanceM : null,
      geofenceRadiusM: nearest ? nearest.radius : null,
    });
  }

  const passers = candidates.filter((row) => row.distanceM <= row.radius);
  if (passers.length === 0) {
    return unrecognized('outside_geofence', {
      accuracyM,
      distanceM: nearest ? nearest.distanceM : null,
      geofenceRadiusM: nearest ? nearest.radius : null,
    });
  }

  const best = passers[0];
  const second = passers[1];
  if (second) {
    const gap = Math.abs(second.distanceM - best.distanceM);
    const ambiguousThreshold = Math.max(AMBIGUOUS_STORE_MIN_GAP_M, accuracyM);
    if (gap < ambiguousThreshold) {
      return unrecognized('ambiguous_store', {
        accuracyM,
        distanceM: best.distanceM,
        geofenceRadiusM: best.radius,
      });
    }
  }

  return {
    recognized: true,
    reason: null,
    store: best.store,
    method: 'geofence',
    distanceM: best.distanceM,
    accuracyM,
    geofenceRadiusM: best.radius,
  };
}
