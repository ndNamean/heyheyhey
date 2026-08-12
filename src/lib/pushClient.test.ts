/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  db: {
    getAuth: vi.fn(async () => ({ refresh_token: 'tok-1' })),
  },
}));

import { fetchWifiNotifyStatus } from './pushClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWifiNotifyStatus payload shaping', () => {
  it('sends lat/lng/accuracy when location is finite and maps geofence fields', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            recognized: true,
            method: 'geofence',
            reason: null,
            storeId: 's1',
            storeCode: 'OHCM',
            distanceM: 12.5,
            accuracyM: 8,
            geofenceRadiusM: 200,
            expiresAt: '2026-08-12T02:45:00.000Z',
            sessionActive: true,
            activeSession: {
              id: 'sess1',
              storeId: 's1',
              storeCode: 'OHCM',
              expiresAt: '2026-08-12T02:45:00.000Z',
              activationMethod: 'geofence',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchWifiNotifyStatus('dev-1', {
      latitude: 10.5,
      longitude: 106.7,
      accuracy: 8,
    });

    expect(out.recognized).toBe(true);
    expect(out.method).toBe('geofence');
    expect(out.distanceM).toBe(12.5);
    expect(out.accuracyM).toBe(8);
    expect(out.geofenceRadiusM).toBe(200);
    expect(out.activeSession?.activationMethod).toBe('geofence');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      deviceId: 'dev-1',
      latitude: 10.5,
      longitude: 106.7,
      accuracy: 8,
    });
  });

  it('omits location when coords are not finite', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ recognized: false, reason: 'ip_unrecognized', method: null }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchWifiNotifyStatus('dev-1', {
      latitude: Number.NaN,
      longitude: 0,
      accuracy: 8,
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      deviceId: 'dev-1',
    });
  });

  it('omits location when not supplied (IP-only status / A)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            recognized: true,
            method: 'wifi_ip',
            storeId: 's1',
            storeCode: 'OHCM',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchWifiNotifyStatus('dev-1');
    expect(out.method).toBe('wifi_ip');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      deviceId: 'dev-1',
    });
  });
});
