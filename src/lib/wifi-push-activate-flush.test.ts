/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFlushPendingPushesForSession,
  mockVerifyRequestUser,
  mockLoadProfileContext,
  mockGetAdminDb,
  mockParseBody,
  mockRecognizeStoreWifi,
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

vi.mock('../../api/_lib/wifi-notify/recognize.js', () => ({
  recognizeStoreWifi: (...args) => mockRecognizeStoreWifi(...args),
  loadActiveSessions: (...args) => mockLoadActiveSessions(...args),
  shouldDeactivateSessionForNetwork: vi.fn(),
}));

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

  it('calls flushPendingPushesForSession after successful activate', async () => {
    const req = {
      method: 'POST',
      headers: { 'user-agent': 'test' },
      query: { action: 'activate' },
      body: {
        action: 'activate',
        deviceId: 'device-1',
        subscription: {
          endpoint: 'https://push.example/ep',
          p256dh: 'p',
          auth: 'a',
        },
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(adminDb.transact).toHaveBeenCalled();
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
        subscription: {
          endpoint: 'https://push.example/ep',
          p256dh: 'p',
          auth: 'a',
        },
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});
