/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSendWebPush } = vi.hoisted(() => ({
  mockSendWebPush: vi.fn(async () => ({ ok: true, statusCode: 201 })),
}));

vi.mock('../../api/_lib/push/web-push-send.js', () => ({
  sendWebPush: mockSendWebPush,
}));

vi.mock('../../api/_lib/export/instant-admin.js', () => ({
  getAdminDb: vi.fn(),
}));

vi.mock('../../api/_lib/export/auth.js', () => ({
  loadProfileContext: vi.fn(async () => ({
    role: 'owner',
    roleDefinition: { canAccessAllStores: true },
    storeIds: ['store-1'],
    storeIdSet: new Set(['store-1']),
  })),
}));

vi.mock('../../api/_lib/wifi-notify/access.js', () => ({
  userHasStoreAccess: vi.fn(() => true),
}));

vi.mock('@instantdb/admin', () => ({
  id: vi.fn(() => 'log-id'),
}));

import { deliverPushForNotificationIds } from '../../api/_lib/push/deliver-notifications.js';

describe('deliverPushForNotificationIds already_sent', () => {
  beforeEach(() => {
    mockSendWebPush.mockClear();
    mockSendWebPush.mockResolvedValue({ ok: true, statusCode: 201 });
  });

  it('suppresses with already_sent and does not send again when a sent log exists', async () => {
    const logged = [];
    const adminDb = {
      query: vi.fn(async (q) => {
        if (q.notifications) {
          return {
            notifications: [
              {
                id: 'n1',
                recipientUserId: 'user-1',
                storeId: 'store-1',
                title: 'Hi',
                body: 'Body',
                readAt: '',
              },
            ],
          };
        }
        if (q.pushDeliveryLogs) {
          return {
            pushDeliveryLogs: [
              { notificationId: 'n1', outcome: 'sent', reason: '' },
            ],
          };
        }
        if (q.notificationActivationSessions) {
          return {
            notificationActivationSessions: [
              {
                id: 'sess1',
                userId: 'user-1',
                storeId: 'store-1',
                wifiIpId: 'w1',
                subscriptionId: 'sub1',
                deviceId: 'd1',
                deactivatedAt: '',
                expiresAt: '',
              },
            ],
          };
        }
        if (q.stores) {
          return {
            stores: [{ id: 'store-1', active: true }],
            storeWifiIps: [{ id: 'w1', active: true }],
            pushSubscriptions: [
              {
                id: 'sub1',
                endpoint: 'https://push.example/x',
                p256dh: 'p',
                auth: 'a',
                revokedAt: '',
              },
            ],
          };
        }
        return {};
      }),
      transact: vi.fn(async (txs) => {
        logged.push(txs);
      }),
      tx: {
        pushDeliveryLogs: {
          'log-id': {
            update: (data) => ({ kind: 'log', data }),
          },
        },
      },
    };
    // Instant-style tx proxy
    adminDb.tx = new Proxy(
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
    );

    const { results } = await deliverPushForNotificationIds(['n1'], { adminDb });

    expect(results).toEqual([
      { notificationId: 'n1', outcome: 'suppressed', reason: 'already_sent' },
    ]);
    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it('still sends when prior logs are only suppressed', async () => {
    const adminDb = {
      query: vi.fn(async (q) => {
        if (q.notifications) {
          return {
            notifications: [
              {
                id: 'n2',
                recipientUserId: 'user-1',
                storeId: 'store-1',
                title: 'Hi',
                body: 'Body',
                readAt: '',
              },
            ],
          };
        }
        if (q.pushDeliveryLogs) {
          return {
            pushDeliveryLogs: [
              {
                notificationId: 'n2',
                outcome: 'suppressed',
                reason: 'no_active_session',
              },
            ],
          };
        }
        if (q.notificationActivationSessions) {
          return {
            notificationActivationSessions: [
              {
                id: 'sess1',
                userId: 'user-1',
                storeId: 'store-1',
                wifiIpId: 'w1',
                subscriptionId: 'sub1',
                deviceId: 'd1',
                deactivatedAt: '',
                expiresAt: '',
              },
            ],
          };
        }
        if (q.stores || q.storeWifiIps || q.pushSubscriptions) {
          return {
            stores: [{ id: 'store-1', active: true }],
            storeWifiIps: [{ id: 'w1', active: true }],
            pushSubscriptions: [
              {
                id: 'sub1',
                endpoint: 'https://push.example/x',
                p256dh: 'p',
                auth: 'a',
                revokedAt: '',
              },
            ],
          };
        }
        return {};
      }),
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

    const { results } = await deliverPushForNotificationIds(['n2'], { adminDb });

    expect(results[0]?.outcome).toBe('sent');
    expect(mockSendWebPush).toHaveBeenCalledTimes(1);
  });
});
