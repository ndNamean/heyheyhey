import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactMock = vi.fn(async () => undefined);
const schedulePushMock = vi.fn();
const deliverLogbookEventMock = vi.fn();

vi.mock('../db', () => ({
  db: {
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      logbookEntries: new Proxy(
        {},
        {
          get: () => ({
            update: (value: Record<string, unknown>) => ({ type: 'entryUpdate', value }),
          }),
        },
      ),
      notifications: new Proxy(
        {},
        {
          get: () => ({
            update: (value: Record<string, unknown>) => ({ type: 'notifUpdate', value }),
          }),
        },
      ),
    },
  },
}));

vi.mock('@instantdb/react', () => ({ id: () => 'notif-id' }));
vi.mock('./pushDelivery', () => ({
  schedulePushDeliveryFromTxs: (...args: unknown[]) => schedulePushMock(...args),
}));
vi.mock('./logbookNotifyClient', () => ({
  deliverLogbookEvent: (...args: unknown[]) => deliverLogbookEventMock(...args),
}));
vi.mock('./utils', () => ({
  nowIso: () => '2026-08-10T12:00:00.000Z',
}));

import { maybeNotifyLogbookDueStates } from './logbookDueNotify';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { LogbookEntry, Profile, Store } from '../types';

const defs = defaultDefinitionsAsEntities();
const storeA: Store = {
  id: 'store-a',
  code: 'TKC',
  name: 'Store A',
  address: '',
  area: '',
  lat: 0,
  lng: 0,
  geofenceRadiusM: 100,
  active: true,
  createdAt: '',
  updatedAt: '',
};

function profile(partial: Partial<Profile> & Pick<Profile, 'role' | 'userId'>): Profile {
  return {
    id: partial.id ?? `p-${partial.userId}`,
    userId: partial.userId,
    email: partial.email ?? `${partial.userId}@test.com`,
    displayName: partial.displayName ?? partial.userId,
    role: partial.role,
    approvalStatus: partial.approvalStatus ?? 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    updatedAt: '',
    stores: partial.stores ?? [storeA],
  };
}

function entry(partial: Partial<LogbookEntry>): LogbookEntry {
  return {
    id: partial.id ?? 'e1',
    storeId: partial.storeId ?? 'store-a',
    authorUserId: partial.authorUserId ?? 'author',
    date: partial.date ?? '2026-08-10',
    shift: partial.shift ?? 'AM',
    content: partial.content ?? 'Leak in cooler',
    severity: partial.severity ?? 'warning',
    isAnnouncement: partial.isAnnouncement ?? false,
    requiresAck: partial.requiresAck ?? false,
    ackUserIdsJson: partial.ackUserIdsJson ?? '[]',
    createdAt: partial.createdAt ?? '2026-08-10T08:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-08-10T08:00:00.000Z',
    entryType: partial.entryType ?? 'issue',
    assigneeRole: partial.assigneeRole ?? 'staff',
    assigneeUserIdsJson: partial.assigneeUserIdsJson ?? '[]',
    dueAt: partial.dueAt,
    status: partial.status ?? 'open',
    overdueNotifiedAt: partial.overdueNotifiedAt ?? '',
    dueSoonNotifiedAt: partial.dueSoonNotifiedAt ?? '',
  };
}

function notifRecipientIds(
  txs: Array<{ type: string; value: Record<string, unknown> }>,
): string[] {
  return txs
    .filter((tx) => tx.type === 'notifUpdate')
    .map((tx) => String(tx.value.recipientUserId ?? ''));
}

describe('maybeNotifyLogbookDueStates overdue split', () => {
  beforeEach(() => {
    transactMock.mockClear();
    schedulePushMock.mockClear();
    deliverLogbookEventMock.mockClear();
  });

  it('stamps overdue inbox once and does not call deliverLogbookEvent', async () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    const actor = profile({ userId: 'mgr', role: 'manager' });
    const staff = profile({ userId: 'staff1', role: 'staff' });
    const overdue = entry({
      id: 'overdue-1',
      dueAt: '2026-08-10T10:00:00.000Z',
      overdueNotifiedAt: '',
    });

    await maybeNotifyLogbookDueStates([overdue], actor, [actor, staff], defs, now);

    expect(transactMock).toHaveBeenCalledTimes(1);
    const txs = transactMock.mock.calls[0]?.[0] as Array<{ type: string; value: Record<string, unknown> }>;
    expect(txs.some((tx) => tx.type === 'notifUpdate')).toBe(true);
    expect(
      txs.some(
        (tx) =>
          tx.type === 'entryUpdate' &&
          tx.value.overdueNotifiedAt === '2026-08-10T12:00:00.000Z',
      ),
    ).toBe(true);
    expect(schedulePushMock).toHaveBeenCalled();
    expect(deliverLogbookEventMock).not.toHaveBeenCalled();
  });

  it('includes assigner when opener is someone else; assignees still receive; no Store Chat', async () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    const actor = profile({ userId: 'mgr', role: 'manager' });
    const assigner = profile({ userId: 'assigner-1', role: 'area_manager' });
    const staff = profile({ userId: 'staff1', role: 'staff' });
    const overdue = entry({
      id: 'overdue-assigner',
      authorUserId: assigner.userId,
      dueAt: '2026-08-10T10:00:00.000Z',
      overdueNotifiedAt: '',
      assigneeUserIdsJson: JSON.stringify([staff.userId]),
    });

    await maybeNotifyLogbookDueStates(
      [overdue],
      actor,
      [actor, assigner, staff],
      defs,
      now,
    );

    expect(transactMock).toHaveBeenCalledTimes(1);
    const txs = transactMock.mock.calls[0]?.[0] as Array<{
      type: string;
      value: Record<string, unknown>;
    }>;
    const recipients = notifRecipientIds(txs);
    expect(recipients).toContain(assigner.userId);
    expect(recipients).toContain(staff.userId);
    expect(deliverLogbookEventMock).not.toHaveBeenCalled();
  });

  it('skips assigner as author when assigner is the opener', async () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    const assigner = profile({ userId: 'assigner-1', role: 'area_manager' });
    const staff = profile({ userId: 'staff1', role: 'staff' });
    const overdue = entry({
      id: 'overdue-self',
      authorUserId: assigner.userId,
      dueAt: '2026-08-10T10:00:00.000Z',
      overdueNotifiedAt: '',
      assigneeUserIdsJson: JSON.stringify([staff.userId]),
    });

    await maybeNotifyLogbookDueStates([overdue], assigner, [assigner, staff], defs, now);

    expect(transactMock).toHaveBeenCalledTimes(1);
    const txs = transactMock.mock.calls[0]?.[0] as Array<{
      type: string;
      value: Record<string, unknown>;
    }>;
    const recipients = notifRecipientIds(txs);
    expect(recipients).not.toContain(assigner.userId);
    expect(recipients).toContain(staff.userId);
    expect(deliverLogbookEventMock).not.toHaveBeenCalled();
  });

  it('skips overdue when already stamped', async () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    const actor = profile({ userId: 'mgr', role: 'manager' });
    const overdue = entry({
      dueAt: '2026-08-10T10:00:00.000Z',
      overdueNotifiedAt: '2026-08-10T11:00:00.000Z',
    });

    await maybeNotifyLogbookDueStates([overdue], actor, [actor], defs, now);

    expect(transactMock).not.toHaveBeenCalled();
    expect(deliverLogbookEventMock).not.toHaveBeenCalled();
  });
});
