import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_STORE_MIN_GAP_M,
  GEO_PRESENCE_TTL_MS,
  MAX_LOCATION_ACCURACY_M,
  geofenceExpiresAtIso,
  haversine,
  isLocationSupplied,
  parseDeviceLocation,
  verifyStoreGeofence,
} from '../../api/_lib/wifi-notify/geofence.js';
import { recognizeStorePresence } from '../../api/_lib/wifi-notify/recognize.js';
import { haversine as clientHaversine, GEO_PRESENCE_TTL_MS as clientTtl } from './geo';

const allowAll = () => true;

function store(partial: Record<string, unknown>) {
  return {
    id: 's1',
    code: 'A',
    active: true,
    lat: 0,
    lng: 0,
    geofenceRadiusM: 200,
    ...partial,
  };
}

describe('geo constants + haversine', () => {
  it('matches client/API constants and distance formula', () => {
    expect(MAX_LOCATION_ACCURACY_M).toBe(100);
    expect(GEO_PRESENCE_TTL_MS).toBe(5 * 60 * 1000);
    expect(clientTtl).toBe(GEO_PRESENCE_TTL_MS);
    expect(AMBIGUOUS_STORE_MIN_GAP_M).toBe(25);
    const d = haversine(0, 0, 0, 0.001);
    expect(d).toBeCloseTo(111.195, 2);
    expect(clientHaversine(0, 0, 0, 0.001)).toBeCloseTo(d, 6);
  });

  it('geofenceExpiresAtIso is now + 5 minutes', () => {
    const now = new Date('2026-08-12T02:40:00.000Z');
    expect(geofenceExpiresAtIso(now)).toBe('2026-08-12T02:45:00.000Z');
  });
});

describe('isLocationSupplied / parseDeviceLocation', () => {
  it('treats omitted or empty payloads as not supplied', () => {
    expect(isLocationSupplied(undefined)).toBe(false);
    expect(isLocationSupplied(null)).toBe(false);
    expect(isLocationSupplied({})).toBe(false);
    expect(isLocationSupplied({ latitude: '', longitude: '', accuracy: '' })).toBe(false);
  });

  it('treats any lat/lng/accuracy field as supplied', () => {
    expect(isLocationSupplied({ latitude: 0, longitude: 0, accuracy: 0 })).toBe(true);
    expect(isLocationSupplied({ lat: 10 })).toBe(true);
    expect(isLocationSupplied({ accuracyM: 12 })).toBe(true);
  });

  it('parses Geolocation names and string numbers', () => {
    expect(parseDeviceLocation({ latitude: '10.5', longitude: '106.7', accuracy: '8' })).toEqual({
      ok: true,
      latitude: 10.5,
      longitude: 106.7,
      accuracyM: 8,
    });
  });

  it('rejects non-finite / out-of-range / negative accuracy', () => {
    expect(parseDeviceLocation({ latitude: 91, longitude: 0, accuracy: 10 }).ok).toBe(false);
    expect(parseDeviceLocation({ latitude: 0, longitude: 181, accuracy: 10 }).ok).toBe(false);
    expect(parseDeviceLocation({ latitude: NaN, longitude: 0, accuracy: 10 }).ok).toBe(false);
    expect(parseDeviceLocation({ latitude: 0, longitude: 0, accuracy: -1 }).ok).toBe(false);
    expect(parseDeviceLocation({ latitude: 0, longitude: 0 }).reason).toBe('malformed_location');
  });
});

describe('verifyStoreGeofence', () => {
  it('recognizes nearest accessible store inside radius with accuracy <= 100', () => {
    const stores = [
      store({ id: 's1', lat: 0, lng: 0, geofenceRadiusM: 200 }),
      store({ id: 's2', lat: 0, lng: 0.005, geofenceRadiusM: 200 }),
    ];
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0, accuracy: 100 },
      stores,
      allowAll,
    );
    expect(out.recognized).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.method).toBe('geofence');
    expect(out.store?.id).toBe('s1');
    expect(out.accuracyM).toBe(100);
    expect(out.distanceM).toBeCloseTo(0, 6);
  });

  it('fails location_inaccurate when accuracy is over 100 even if inside', () => {
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0, accuracy: 101 },
      [store({ geofenceRadiusM: 500 })],
      allowAll,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('location_inaccurate');
    expect(out.store).toBeNull();
    expect(out.accuracyM).toBe(101);
  });

  it('fails outside_geofence when beyond radius', () => {
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0.003, accuracy: 15 },
      [store({ geofenceRadiusM: 200 })],
      allowAll,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('outside_geofence');
    expect(out.store).toBeNull();
    expect(out.distanceM).toBeGreaterThan(200);
  });

  it('returns ambiguous_store when top two passers are closer than max(25, accuracyM)', () => {
    const stores = [
      store({ id: 's1', lat: 0, lng: 0, geofenceRadiusM: 500 }),
      store({ id: 's2', lat: 0, lng: 0.0002, geofenceRadiusM: 500 }),
    ];
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0.0001, accuracy: 10 },
      stores,
      allowAll,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('ambiguous_store');
    expect(out.store).toBeNull();
  });

  it('picks nearest when passer gap is at least max(25, accuracyM)', () => {
    const stores = [
      store({ id: 's1', lat: 0, lng: 0, geofenceRadiusM: 500 }),
      store({ id: 's2', lat: 0, lng: 0.0005, geofenceRadiusM: 500 }),
    ];
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0, accuracy: 10 },
      stores,
      allowAll,
    );
    expect(out.recognized).toBe(true);
    expect(out.store?.id).toBe('s1');
    expect(out.distanceM).toBeCloseTo(0, 6);
    expect(out.distanceM! + 25).toBeLessThan(haversine(0, 0, 0, 0.0005) + 1e-6);
  });

  it('filters inactive, inaccessible, and zero-radius stores', () => {
    const stores = [
      store({ id: 'inactive', active: false }),
      store({ id: 'no-radius', geofenceRadiusM: 0 }),
      store({ id: 'no-coords', lat: null, lng: null }),
      store({ id: 'denied' }),
    ];
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0, accuracy: 10 },
      stores,
      (id) => id !== 'denied',
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('outside_geofence');
  });

  it('uses ctx store access when a context object is passed', () => {
    const stores = [store({ id: 's1' }), store({ id: 's2', lat: 0, lng: 0.00001 })];
    const out = verifyStoreGeofence(
      { latitude: 0, longitude: 0, accuracy: 5 },
      stores,
      { role: 'staff', roleDefinition: {}, storeIds: ['s2'] },
    );
    expect(out.recognized).toBe(true);
    expect(out.store?.id).toBe('s2');
  });

  it('ignores client insideStore / recognized flags', () => {
    const out = verifyStoreGeofence(
      {
        latitude: 0,
        longitude: 0.01,
        accuracy: 10,
        insideStore: true,
        recognized: true,
      },
      [store({ geofenceRadiusM: 50 })],
      allowAll,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('outside_geofence');
  });

  it('returns malformed_location for bad coords', () => {
    const out = verifyStoreGeofence(
      { latitude: Infinity, longitude: 0, accuracy: 10 },
      [store({})],
      allowAll,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('malformed_location');
    expect(out.accuracyM).toBeNull();
  });
});

describe('recognizeStorePresence', () => {
  const ctx = {
    role: 'owner',
    roleDefinition: { canAccessAllStores: false },
    storeIds: ['s1'],
    storeIdSet: new Set(['s1']),
  };

  it('returns wifi_ip without consulting location when IP matches', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [{ id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true }],
        stores: [store({ id: 's1', code: 'OHCM' })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '203.0.113.10' } },
      adminDb,
      ctx,
      { latitude: 0, longitude: 0, accuracy: 10 },
    );
    expect(out.recognized).toBe(true);
    expect(out.method).toBe('wifi_ip');
    expect(out.wifiIp?.id).toBe('w1');
    expect(out.distanceM).toBeNull();
  });

  it('falls back to geofence when IP fails and location is supplied', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1', code: 'OHCM', geofenceRadiusM: 200 })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
      { latitude: 0, longitude: 0, accuracy: 12 },
    );
    expect(out.recognized).toBe(true);
    expect(out.method).toBe('geofence');
    expect(out.wifiIp).toBeNull();
    expect(out.publicIp).toBe('198.51.100.9');
    expect(out.store?.id).toBe('s1');
    expect(out.accuracyM).toBe(12);
  });

  it('preserves IP reason when location is omitted', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1' })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('ip_unrecognized');
    expect(out.method).toBeNull();
    expect(out.publicIp).toBe('198.51.100.9');
  });

  it('preserves IP reason when location fields are empty (G)', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1' })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
      { latitude: '', longitude: '', accuracy: '' },
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('ip_unrecognized');
    expect(out.method).toBeNull();
  });

  it('returns outside_geofence for unknown IP outside the store (E)', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1', geofenceRadiusM: 200 })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
      { latitude: 0, longitude: 0.01, accuracy: 10 },
    );
    expect(out.recognized).toBe(false);
    expect(out.method).toBe('geofence');
    expect(out.reason).toBe('outside_geofence');
    expect(out.store).toBeNull();
    expect(out.wifiIp).toBeNull();
  });

  it('returns location_inaccurate through presence when accuracy > 100 (F)', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1', geofenceRadiusM: 500 })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
      { latitude: 0, longitude: 0, accuracy: 101 },
    );
    expect(out.recognized).toBe(false);
    expect(out.method).toBe('geofence');
    expect(out.reason).toBe('location_inaccurate');
    expect(out.accuracyM).toBe(101);
  });

  it('returns ambiguous_store through presence when two nearby stores pass', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [
          store({ id: 's1', lat: 0, lng: 0, geofenceRadiusM: 500 }),
          store({ id: 's2', lat: 0, lng: 0.0002, geofenceRadiusM: 500 }),
        ],
      }),
    };
    const ctxBoth = {
      ...ctx,
      storeIds: ['s1', 's2'],
      storeIdSet: new Set(['s1', 's2']),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctxBoth,
      { latitude: 0, longitude: 0.0001, accuracy: 10 },
    );
    expect(out.recognized).toBe(false);
    expect(out.method).toBe('geofence');
    expect(out.reason).toBe('ambiguous_store');
    expect(out.store).toBeNull();
  });

  it('returns malformed_location through presence for bad coords', async () => {
    const adminDb = {
      query: async () => ({
        storeWifiIps: [],
        stores: [store({ id: 's1' })],
      }),
    };
    const out = await recognizeStorePresence(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      adminDb,
      ctx,
      { latitude: 91, longitude: 0, accuracy: 10 },
    );
    expect(out.recognized).toBe(false);
    expect(out.method).toBe('geofence');
    expect(out.reason).toBe('malformed_location');
  });
});
