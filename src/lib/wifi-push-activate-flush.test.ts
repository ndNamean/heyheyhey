/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFlushPendingPushesForSession,
  mockVerifyRequestUser,
  mockLoadProfileContext,
  mockGetAdminDb,
  mockParseBody,
  mockRecognizeStoreWifi,
  mockRecognizeStorePresence,
  mockLoadActiveSessions,
  mockParseSubscriptionPayload,
  mockUpsertPushSubscription,
  mockDeactivateSessions,
  mockId,
} = vi.hoisted(() => ({
  mockFlushPendingPushesForSession: vi.fn(async () => ({
    notificationIds: ['n-pending'],
    results: [{ notificationId: 'n-pending', outcome: 'sent' }],
  })),
  mockVerifyRequestUser: vi.fn(async () => ({ userId: 'user-1' })),
  mockLoadProfileContext: vi.fn(async () => ({ role: 'owner', storeIds: ['store-1'] })),
  mockGetAdminDb: vi.fn(),
  mockParseBody: vi.fn((body) => body || {}),
  mockRecognizeStoreWifi: vi.fn(),
  mockRecognizeStorePresence: vi.fn(),
  mockLoadActiveSessions: vi.fn(async () => []),
  mockParseSubscriptionPayload: vi.fn((sub) => sub),
  mockUpsertPushSubscription: vi.fn(async () => ({ subscriptionId: 'sub-1' })),
  mockDeactivateSessions: vi.fn(async () => 0),
  mockId: vi.fn(() => 'session-new'),
}));

vi.mock('../../api/_lib/push/flush-pending.js', () => ({
  flushPendingPushesForSession: (...args) => mockFlushPendingPushesForSession(...args),
}));

vi.mock('../../api/_lib/export/auth.js', () => ({
  verifyRequestUser: (...args) => mockVerifyRequestUser(...args),
  loadProfileContext: (...args) => mockLoadProfileContext(...args),
}));

vi.mock('../../api/_lib/export/instant-admin.js', () => ({
  getAdminDb: (...args) => mockGetAdminDb(...args),
  parseBody: (...args) => mockParseBody(...args),
}));

vi.mock('../../api/_lib/wifi-notify/recognize.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/_lib/wifi-notify/recognize.js')>();
  return {
    ...actual,
    recognizeStoreWifi: (...args) => mockRecognizeStoreWifi(...args),
    recognizeStorePresence: (...args) => mockRecognizeStorePresence(...args),
    loadActiveSessions: (...args) => mockLoadActiveSessions(...args),
  };
});

vi.mock('../../api/_lib/push/subscriptions.js', () => ({
  parseSubscriptionPayload: (...args) => mockParseSubscriptionPayload(...args),
  upsertPushSubscription: (...args) => mockUpsertPushSubscription(...args),
  deactivateSessions: (...args) => mockDeactivateSessions(...args),
  findSubscriptionForDevice: vi.fn(),
  revokePushSubscription: vi.fn(),
}));

vi.mock('../../api/_lib/push/web-push-send.js', () => ({
  getVapidConfig: vi.fn(() => ({ publicKey: 'pk' })),
  sendWebPush: vi.fn(),
}));

vi.mock('../../api/_lib/push/deliver-notifications.js', () => ({
  deliverPushForNotificationIds: vi.fn(async () => ({ results: [] })),
}));

vi.mock('../../api/_lib/wifi-notify/request-ip.js', () => ({
  getClientPublicIp: vi.fn(() => '203.0.113.10'),
}));

vi.mock('../../api/_lib/wifi-notify/access.js', () => ({
  roleCanEditMaster: vi.fn(() => false),
  userHasStoreAccess: vi.fn(() => true),
}));

vi.mock('@instantdb/admin', () => ({
  id: (...args) => mockId(...args),
}));

import handler from '../../api/wifi-push.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return res;
}

describe('wifi-push activate flush hook', () => {
  const adminDb = {
    query: vi.fn(async () => ({})),
    transact: vi.fn(async () => {}),
    tx: new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: () => ({
                update: (data) => ({ update: data }),
              }),
            },
          ),
      },
    ),
  };

  const subscription = {
    endpoint: 'https://push.example/ep',
    p256dh: 'p',
    auth: 'a',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminDb.mockReturnValue(adminDb);
    mockVerifyRequestUser.mockResolvedValue({ userId: 'user-1' });
    mockLoadProfileContext.mockResolvedValue({ role: 'owner', storeIds: ['store-1'] });
    mockParseBody.mockImplementation((body) => body || {});
    mockRecognizeStoreWifi.mockResolvedValue({
      recognized: true,
      reason: null,
      store: { id: 'store-1', code: 'OHCM', active: true },
      wifiIp: { id: 'wifi-1', active: true },
      publicIp: '203.0.113.10',
      shift: null,
      expiresAt: '',
      method: 'wifi_ip',
      distanceM: null,
      accuracyM: null,
    });
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: true,
      reason: null,
      store: { id: 'store-1', code: 'OHCM', active: true },
      wifiIp: { id: 'wifi-1', active: true },
      publicIp: '203.0.113.10',
      shift: null,
      expiresAt: '',
      method: 'wifi_ip',
      distanceM: null,
      accuracyM: null,
    });
    mockLoadActiveSessions.mockResolvedValue([]);
    mockParseSubscriptionPayload.mockImplementation((sub) => sub);
    mockUpsertPushSubscription.mockResolvedValue({ subscriptionId: 'sub-1' });
    mockDeactivateSessions.mockResolvedValue(0);
    mockId.mockReturnValue('session-new');
    mockFlushPendingPushesForSession.mockResolvedValue({
      notificationIds: ['n-pending'],
      results: [{ notificationId: 'n-pending', outcome: 'sent' }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls flushPendingPushesForSession after successful activate', async () => {
    const req = {
      method: 'POST',
      headers: { 'user-agent': 'test' },
      query: { action: 'activate' },
      body: {
        action: 'activate',
        deviceId: 'device-1',
        subscription,
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.method).toBe('wifi_ip');
    expect(res.body?.expiresAt).toBe('');
    expect(adminDb.transact).toHaveBeenCalled();
    expect(adminDb.transact.mock.calls[0][0].update).toMatchObject({
      activationMethod: 'wifi_ip',
      wifiIpId: 'wifi-1',
      matchedPublicIp: '203.0.113.10',
      expiresAt: '',
    });
    expect(mockFlushPendingPushesForSession).toHaveBeenCalledWith({
      adminDb,
      userId: 'user-1',
      storeId: 'store-1',
    });
  });

  it('still returns ok when flush rejects', async () => {
    mockFlushPendingPushesForSession.mockRejectedValueOnce(new Error('flush boom'));

    const req = {
      method: 'POST',
      headers: {},
      query: { action: 'activate' },
      body: {
        deviceId: 'device-1',
        subscription,
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it('activates geofence session with 5m TTL, empty wifiIpId, then flushes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T02:40:00.000Z'));
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: true,
      reason: null,
      store: { id: 'store-1', code: 'OHCM', active: true, geofenceRadiusM: 200 },
      wifiIp: null,
      publicIp: '198.51.100.9',
      shift: null,
      expiresAt: '',
      method: 'geofence',
      distanceM: 15,
      accuracyM: 8,
      geofenceRadiusM: 200,
    });

    const req = {
      method: 'POST',
      headers: {},
      query: { action: 'activate' },
      body: {
        deviceId: 'device-1',
        subscription,
        latitude: 0,
        longitude: 0,
        accuracy: 8,
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.method).toBe('geofence');
    expect(res.body?.expiresAt).toBe('2026-08-12T02:45:00.000Z');
    expect(res.body?.accuracyM).toBe(8);
    expect(adminDb.transact.mock.calls[0][0].update).toMatchObject({
      activationMethod: 'geofence',
      wifiIpId: '',
      matchedPublicIp: '',
      expiresAt: '2026-08-12T02:45:00.000Z',
      verifiedLat: '0',
      verifiedLng: '0',
      locationAccuracyM: '8',
      distanceFromStoreM: '15',
      presenceVerifiedAt: '2026-08-12T02:40:00.000Z',
    });
    expect(mockFlushPendingPushesForSession).toHaveBeenCalledWith({
      adminDb,
      userId: 'user-1',
      storeId: 'store-1',
    });
  });

  it('rejects activate when presence is unrecognized (E/F/G)', async () => {
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: false,
      reason: 'outside_geofence',
      store: null,
      wifiIp: null,
      publicIp: '198.51.100.9',
      method: 'geofence',
      distanceM: 400,
      accuracyM: 12,
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'activate' },
        body: { deviceId: 'device-1', subscription, latitude: 0, longitude: 0.01, accuracy: 12 },
      },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body?.reason).toBe('outside_geofence');
    expect(res.body?.method).toBe('geofence');
    expect(adminDb.transact).not.toHaveBeenCalled();
    expect(mockFlushPendingPushesForSession).not.toHaveBeenCalled();
  });

  it('forwards lat/lng/accuracy from status body to recognizeStorePresence', async () => {
    const req = {
      method: 'POST',
      headers: {},
      query: { action: 'status' },
      body: {
        deviceId: 'device-1',
        latitude: 10.5,
        longitude: 106.7,
        accuracy: 8,
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockRecognizeStorePresence).toHaveBeenCalledWith(
      req,
      adminDb,
      expect.anything(),
      expect.objectContaining({
        latitude: 10.5,
        longitude: 106.7,
        accuracy: 8,
      }),
    );
  });

  it('does not deactivate geofence session on IP-only miss', async () => {
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: false,
      reason: 'ip_unrecognized',
      store: null,
      wifiIp: null,
      publicIp: '198.51.100.9',
      method: null,
      distanceM: null,
      accuracyM: null,
    });
    mockLoadActiveSessions.mockResolvedValue([
      {
        id: 'sess-geo',
        storeId: 'store-1',
        storeCode: 'OHCM',
        activationMethod: 'geofence',
        wifiIpId: '',
        expiresAt: '2026-08-12T02:45:00.000Z',
        presenceVerifiedAt: '2026-08-12T02:40:00.000Z',
      },
    ]);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'status' },
        body: { deviceId: 'device-1' },
      },
      res,
    );

    expect(mockDeactivateSessions).not.toHaveBeenCalled();
    expect(res.body?.sessionActive).toBe(true);
    expect(res.body?.activeSession).toMatchObject({
      id: 'sess-geo',
      activationMethod: 'geofence',
      expiresAt: '2026-08-12T02:45:00.000Z',
    });
  });

  it('extends geofence session TTL when geo re-verify matches same store', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T02:50:00.000Z'));
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: true,
      reason: null,
      store: { id: 'store-1', code: 'OHCM', active: true, geofenceRadiusM: 200 },
      wifiIp: null,
      publicIp: '198.51.100.9',
      method: 'geofence',
      distanceM: 12,
      accuracyM: 8,
      geofenceRadiusM: 200,
    });
    mockLoadActiveSessions.mockResolvedValue([
      {
        id: 'sess-geo',
        storeId: 'store-1',
        storeCode: 'OHCM',
        activationMethod: 'geofence',
        wifiIpId: '',
        expiresAt: '2026-08-12T02:45:00.000Z',
        presenceVerifiedAt: '2026-08-12T02:40:00.000Z',
      },
    ]);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'status' },
        body: { deviceId: 'device-1', latitude: 0, longitude: 0, accuracy: 8 },
      },
      res,
    );

    expect(mockDeactivateSessions).not.toHaveBeenCalled();
    expect(adminDb.transact).toHaveBeenCalled();
    expect(adminDb.transact.mock.calls[0][0].update).toMatchObject({
      activationMethod: 'geofence',
      wifiIpId: '',
      expiresAt: '2026-08-12T02:55:00.000Z',
      presenceVerifiedAt: '2026-08-12T02:50:00.000Z',
    });
    expect(res.body?.activeSession?.expiresAt).toBe('2026-08-12T02:55:00.000Z');
    expect(res.body?.activeSession?.activationMethod).toBe('geofence');
  });

  it('upgrades geofence session to wifi_ip when public IP matches same store (L)', async () => {
    mockRecognizeStorePresence.mockResolvedValue({
      recognized: true,
      reason: null,
      store: { id: 'store-1', code: 'OHCM', active: true },
      wifiIp: { id: 'wifi-1', active: true },
      publicIp: '203.0.113.10',
      method: 'wifi_ip',
      distanceM: null,
      accuracyM: null,
    });
    mockLoadActiveSessions.mockResolvedValue([
      {
        id: 'sess-geo',
        storeId: 'store-1',
        storeCode: 'OHCM',
        activationMethod: 'geofence',
        wifiIpId: '',
        expiresAt: '2026-08-12T02:45:00.000Z',
        presenceVerifiedAt: '2026-08-12T02:40:00.000Z',
      },
    ]);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'status' },
        body: { deviceId: 'device-1' },
      },
      res,
    );

    expect(mockDeactivateSessions).not.toHaveBeenCalled();
    expect(adminDb.transact.mock.calls[0][0].update).toMatchObject({
      activationMethod: 'wifi_ip',
      wifiIpId: 'wifi-1',
      matchedPublicIp: '203.0.113.10',
      expiresAt: '',
    });
    expect(res.body?.method).toBe('wifi_ip');
    expect(res.body?.activeSession?.activationMethod).toBe('wifi_ip');
    expect(res.body?.activeSession?.expiresAt).toBe('');
  });
});
