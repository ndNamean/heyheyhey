/** Earth radius in metres (mean). */
const EARTH_RADIUS_M = 6_371_000;

/** Max acceptable geolocation accuracy for store geofence presence. */
export const MAX_LOCATION_ACCURACY_M = 100;

/** Geofence activation session TTL (5 minutes). */
export const GEO_PRESENCE_TTL_MS = 5 * 60 * 1000;

/**
 * Great-circle distance in metres between two WGS84 points.
 * Same formula as the former ShiftsPage helper (R = 6_371_000).
 */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
