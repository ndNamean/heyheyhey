/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeliverPushForNotificationIds } = vi.hoisted(() => ({
  mockDeliverPushForNotificationIds: vi.fn(async () => ({
    results: [{ notificationId: 'n-ok', outcome: 'sent' }],
  })),
}));

vi.mock('../../api/_lib/push/deliver-notifications.js', () => ({
  deliverPushForNotificationIds: (...args) => mockDeliverPushForNotificationIds(...args),
}));

import {
  PENDING_PUSH_MAX,
  selectPendingPushNotificationIds,
  flushPendingPushesForSession,
} from '../../api/_lib/push/flush-pending.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function notif(partial) {
  return {
    id: partial.id,
    recipientUserId: partial.recipientUserId ?? 'user-1',
    storeId: partial.storeId ?? 'store-1',
    readAt: partial.readAt ?? '',
    createdAt: partial.createdAt ?? '2026-07-30T12:00:00.000Z',
  };
}

describe('selectPendingPushNotificationIds', () => {
  const opts = { userId: 'user-1', storeId: 'store-1', now: NOW };

  it('includes unread never-sent notifications for the user/store', () => {
    const ids = selectPendingPushNotificationIds(
      [notif({ id: 'n1' }), notif({ id: 'n2', createdAt: '2026-07-29T12:00:00.000Z' })],
      new Set(),
      opts,
    );
    expect(ids).toEqual(['n2', 'n1']);
  });

  it('excludes read notifications', () => {
    const ids = selectPendingPushNotificationIds(
      [notif({ id: 'n1', readAt: '2026-07-30T15:00:00.000Z' })],
      new Set(),
      opts,
    );
    expect(ids).toEqual([]);
  });

  it('excludes other store and other recipient', () => {
    const ids = selectPendingPushNotificationIds(
      [
        notif({ id: 'n1', storeId: 'store-2' }),
        notif({ id: 'n2', recipientUserId: 'user-2' }),
      ],
      new Set(),
      opts,
    );
    expect(ids).toEqual([]);
  });

  it('excludes already-sent notification ids', () => {
    const ids = selectPendingPushNotificationIds(
      [notif({ id: 'n1' }), notif({ id: 'n2' })],
      new Set(['n1']),
      opts,
    );
    expect(ids).toEqual(['n2']);
  });

  it('excludes notifications older than 7 days', () => {
    const old = new Date(NOW.getTime() - 8 * DAY_MS).toISOString();
    const recent = new Date(NOW.getTime() - 6 * DAY_MS).toISOString();
    const ids = selectPendingPushNotificationIds(
      [notif({ id: 'old', createdAt: old }), notif({ id: 'ok', createdAt: recent })],
      new Set(),
      opts,
    );
    expect(ids).toEqual(['ok']);
  });

  it('caps at 50 oldest first', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      notif({
        id: `n${i}`,
        createdAt: new Date(NOW.getTime() - (60 - i) * 60_000).toISOString(),
      }),
    );
    const ids = selectPendingPushNotificationIds(many, new Set(), opts);
    expect(ids).toHaveLength(PENDING_PUSH_MAX);
    expect(ids[0]).toBe('n0');
    expect(ids[49]).toBe('n49');
  });
});

describe('flushPendingPushesForSession', () => {
  beforeEach(() => {
    mockDeliverPushForNotificationIds.mockClear();
    mockDeliverPushForNotificationIds.mockResolvedValue({
      results: [{ notificationId: 'n-ok', outcome: 'sent' }],
    });
  });

  it('loads unread rows, drops already-sent, and delivers selected ids', async () => {
    const adminDb = {
      query: vi.fn(async (q) => {
        if (q.notifications) {
          return {
            notifications: [
              notif({ id: 'n-ok' }),
              notif({ id: 'n-sent' }),
              notif({ id: 'n-read', readAt: NOW.toISOString() }),
            ],
          };
        }
        if (q.pushDeliveryLogs) {
          return {
            pushDeliveryLogs: [{ notificationId: 'n-sent', outcome: 'sent' }],
          };
        }
        return {};
      }),
    };

    const out = await flushPendingPushesForSession({
      adminDb,
      userId: 'user-1',
      storeId: 'store-1',
      now: NOW,
    });

    expect(out.notificationIds).toEqual(['n-ok']);
    expect(mockDeliverPushForNotificationIds).toHaveBeenCalledWith(['n-ok'], { adminDb });
  });
});
