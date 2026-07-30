/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { extractNotificationIdsFromTxs } from './pushDelivery';

describe('extractNotificationIdsFromTxs', () => {
  it('pulls notification ids from Instant __ops chunks', () => {
    const txs = [
      {
        __etype: 'notifications',
        __ops: [['update', 'notifications', 'notif-a', { title: 'A' }]],
      },
      {
        __etype: 'logbookEntries',
        __ops: [['update', 'logbookEntries', 'entry-1', { status: 'open' }]],
      },
      {
        __etype: 'notifications',
        __ops: [
          ['update', 'notifications', 'notif-b', { title: 'B' }],
          ['link', 'notifications', 'notif-b', { x: 1 }],
        ],
      },
    ];
    expect(extractNotificationIdsFromTxs(txs)).toEqual(['notif-a', 'notif-b']);
  });

  it('returns empty for non-chunks', () => {
    expect(extractNotificationIdsFromTxs([null, {}, 'x'])).toEqual([]);
  });
});
