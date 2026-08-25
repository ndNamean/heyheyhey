/**
 * @vitest-environment node
 */
// @ts-nocheck — exercises plain JS Admin helper
import { describe, expect, it } from 'vitest';
import {
  nextUnreadCount,
  tallyRecipientDeltas,
  extractNotificationRecipientIdsFromTxs,
  applyUnreadCountDeltas,
} from '../../api/_lib/notifications/unread-count.js';

describe('admin unread-count helpers', () => {
  it('tallies and floors like the client helpers', () => {
    expect(tallyRecipientDeltas(['x', 'y', 'x']).get('x')).toBe(2);
    expect(nextUnreadCount(1, -3)).toBe(0);
  });

  it('extracts recipients from create txs', () => {
    expect(
      extractNotificationRecipientIdsFromTxs([
        {
          __ops: [['update', 'notifications', 'n1', { recipientUserId: 'u9' }]],
        },
      ]),
    ).toEqual(['u9']);
  });

  it('applyUnreadCountDeltas upserts via admin transact', async () => {
    /** @type {any[]} */
    const updates = [];
    const adminDb = {
      query: async () => ({
        notificationUnreadCounts: [{ id: 'c1', userId: 'u1', unreadCount: 5 }],
      }),
      transact: async (txs) => {
        updates.push(txs);
      },
      tx: {
        notificationUnreadCounts: new Proxy(
          {},
          {
            get: (_t, rowId) => ({
              update: (attrs) => ({ id: rowId, attrs }),
            }),
          },
        ),
      },
    };

    const result = await applyUnreadCountDeltas(adminDb, { u1: 2, u2: 1 });
    expect(result.bumped).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveLength(2);
    const u1Tx = updates[0].find((t) => t.id === 'c1');
    const u2Tx = updates[0].find((t) => t.id !== 'c1');
    expect(u1Tx.attrs.unreadCount).toBe(7);
    expect(u1Tx.attrs.userId).toBeUndefined();
    expect(u2Tx.attrs.userId).toBe('u2');
    expect(u2Tx.attrs.unreadCount).toBe(1);
  });
});
