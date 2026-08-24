import { describe, expect, it, vi } from 'vitest';
import { markNotificationsReadBatched } from './notifications';
import type { Notification } from '../types';

function notification(id: string, readAt = ''): Notification {
  return {
    id,
    recipientUserId: 'u-1',
    type: 'item_approved',
    reportId: '',
    reportResponseId: '',
    storeId: '',
    title: `Notification ${id}`,
    body: '',
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: '',
    actorUserId: '',
    actorRole: '',
    readAt,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('markNotificationsReadBatched', () => {
  it('creates read transactions for unread ids in batches', async () => {
    const transact = vi.fn(async () => undefined);
    const buildTx = vi.fn((id: string, readAt: string) => ({ id, readAt }));
    const list = [
      notification('n-1'),
      notification('n-2', '2026-01-01T00:00:00.000Z'),
      notification('n-3'),
      notification('n-4'),
    ];

    const processed = await markNotificationsReadBatched(list, {
      batchSize: 2,
      readAt: '2026-08-24T08:00:00.000Z',
      buildTx,
      transact,
    });

    expect(processed).toBe(3);
    expect(transact).toHaveBeenCalledTimes(2);
    expect(transact).toHaveBeenNthCalledWith(1, [
      { id: 'n-1', readAt: '2026-08-24T08:00:00.000Z' },
      { id: 'n-3', readAt: '2026-08-24T08:00:00.000Z' },
    ]);
    expect(transact).toHaveBeenNthCalledWith(2, [
      { id: 'n-4', readAt: '2026-08-24T08:00:00.000Z' },
    ]);
    expect(buildTx).toHaveBeenCalledTimes(3);
  });

  it('is a no-op when there are no unread notifications', async () => {
    const transact = vi.fn(async () => undefined);
    const buildTx = vi.fn((id: string, readAt: string) => ({ id, readAt }));

    const processed = await markNotificationsReadBatched(
      [notification('n-1', '2026-01-01T00:00:00.000Z')],
      { buildTx, transact },
    );

    expect(processed).toBe(0);
    expect(buildTx).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
  });
});
