/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  db: {
    tx: {
      notificationUnreadCounts: new Proxy(
        {},
        {
          get: (_t, rowId: string) => ({
            update: (attrs: Record<string, unknown>) => ({
              __etype: 'notificationUnreadCounts',
              __ops: [['update', 'notificationUnreadCounts', rowId, attrs]],
            }),
          }),
        },
      ),
    },
    queryOnce: vi.fn(),
    getAuth: vi.fn(),
  },
}));

vi.mock('@instantdb/react', () => ({
  id: () => 'generated-id',
}));

import {
  nextUnreadCount,
  tallyRecipientDeltas,
  extractNotificationRecipientIdsFromTxs,
  buildUnreadCountDeltaTx,
  NOTIFICATION_PAGE_SIZE,
} from './notificationUnreadCount';

describe('notificationUnreadCount helpers', () => {
  it('uses page size 15', () => {
    expect(NOTIFICATION_PAGE_SIZE).toBe(15);
  });

  it('tallies recipient deltas', () => {
    const map = tallyRecipientDeltas(['a', 'b', 'a', '', 'a']);
    expect(map.get('a')).toBe(3);
    expect(map.get('b')).toBe(1);
  });

  it('floors unread count at 0', () => {
    expect(nextUnreadCount(2, -5)).toBe(0);
    expect(nextUnreadCount(undefined, 3)).toBe(3);
    expect(nextUnreadCount(4, 2)).toBe(6);
  });

  it('extracts recipient ids only from notification creates with recipientUserId', () => {
    const txs = [
      {
        __ops: [
          ['update', 'notifications', 'n1', { recipientUserId: 'u1', title: 'Hi' }],
        ],
      },
      {
        __ops: [['update', 'notifications', 'n2', { readAt: '2020-01-01' }]],
      },
      {
        __ops: [['update', 'profiles', 'p1', { recipientUserId: 'nope' }]],
      },
    ];
    expect(extractNotificationRecipientIdsFromTxs(txs)).toEqual(['u1']);
  });

  it('buildUnreadCountDeltaTx omits userId when updating existing row', () => {
    const tx = buildUnreadCountDeltaTx(
      'user-1',
      -1,
      { id: 'row-1', userId: 'user-1', unreadCount: 3 },
    ) as { __ops: unknown[] };
    const attrs = (tx.__ops[0] as unknown[])[3] as Record<string, unknown>;
    expect(attrs.unreadCount).toBe(2);
    expect(attrs).not.toHaveProperty('userId');
  });

  it('buildUnreadCountDeltaTx includes userId on create', () => {
    const tx = buildUnreadCountDeltaTx('user-1', 2, null) as { __ops: unknown[] };
    const attrs = (tx.__ops[0] as unknown[])[3] as Record<string, unknown>;
    expect(attrs.userId).toBe('user-1');
    expect(attrs.unreadCount).toBe(2);
  });
});
