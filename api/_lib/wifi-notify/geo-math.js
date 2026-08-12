/**
 * Haversine + geofence constants (API mirror of src/lib/geo.ts).
 * Do not import from src/ — Vercel api/ cannot depend on the Vite tree.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Max acceptable geolocation accuracy for store geofence presence. */
export const MAX_LOCATION_ACCURACY_M = 100;

/** Geofence activation session TTL (5 minutes). */
export const GEO_PRESENCE_TTL_MS = 5 * 60 * 1000;

/**
 * Great-circle distance in metres between two WGS84 points.
 * Must stay in lockstep with src/lib/geo.ts.
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ISO timestamp for geofence session expiry (now + GEO_PRESENCE_TTL_MS). */
export function geofenceExpiresAtIso(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + GEO_PRESENCE_TTL_MS).toISOString();
}
