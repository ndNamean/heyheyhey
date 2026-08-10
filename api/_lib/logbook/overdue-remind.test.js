import { describe, expect, it } from 'vitest';
import {
  canActorRemindOverdueChat,
  evaluateRemindOverdueGuards,
  getAssigneeRecipientUserIds,
  overdueRemindChatDeliveryKey,
} from './overdue-remind.js';

const hasStoreAccess = (p, storeId) =>
  (p.stores || []).some((s) => s.id === storeId) || p.role === 'owner';

const helpers = {
  hasStoreAccess,
  canReviewRole: (role) =>
    ['owner', 'admin', 'areaManager', 'manager', 'leader'].includes(role),
  rankOf: (role) => {
    const legacy = {
      owner: 0,
      admin: 1,
      areaManager: 2,
      manager: 3,
      leader: 4,
      staff: 7,
    };
    return legacy[role] ?? 99;
  },
};

const overdueEntry = {
  id: 'e1',
  entryType: 'issue',
  storeId: 'store-a',
  status: 'open',
  dueAt: '2026-08-10T10:00:00.000Z',
  assigneeRole: 'staff',
  assigneeUserIdsJson: '[]',
  overdueChatRemindedAt: '',
};

const nowMs = Date.parse('2026-08-10T12:00:00.000Z');

describe('overdueRemindChatDeliveryKey', () => {
  it('uses stable once key', () => {
    expect(overdueRemindChatDeliveryKey('e1', 'store-a')).toBe(
      'logbook-chat:e1:overdue_remind:once:store-a',
    );
  });
});

describe('canActorRemindOverdueChat', () => {
  it('allows manager/owner; rejects staff assignee and unauthorized', () => {
    const manager = {
      userId: 'mgr',
      role: 'manager',
      approvalStatus: 'approved',
      stores: [{ id: 'store-a' }],
    };
    const staff = {
      userId: 'staff1',
      role: 'staff',
      approvalStatus: 'approved',
      stores: [{ id: 'store-a' }],
    };
    const stranger = {
      userId: 'x',
      role: 'manager',
      approvalStatus: 'approved',
      stores: [{ id: 'other' }],
    };
    expect(canActorRemindOverdueChat(manager, overdueEntry, [], helpers)).toBe(true);
    expect(canActorRemindOverdueChat(staff, overdueEntry, [], helpers)).toBe(false);
    expect(canActorRemindOverdueChat(stranger, overdueEntry, [], helpers)).toBe(false);
  });
});

describe('evaluateRemindOverdueGuards', () => {
  it('passes when overdue, assigned, not reminded', () => {
    expect(
      evaluateRemindOverdueGuards(overdueEntry, ['staff1'], {
        nowMs,
        chatNotifyEnabled: true,
      }),
    ).toEqual({ ok: true });
  });

  it('skips already reminded / resolved / unassigned / disabled chat', () => {
    expect(
      evaluateRemindOverdueGuards(
        { ...overdueEntry, overdueChatRemindedAt: '2026-08-10T11:00:00.000Z' },
        ['staff1'],
        { nowMs },
      ),
    ).toMatchObject({ ok: false, reason: 'already_reminded', skipped: true });

    expect(
      evaluateRemindOverdueGuards({ ...overdueEntry, status: 'resolved' }, ['staff1'], {
        nowMs,
      }),
    ).toMatchObject({ ok: false, reason: 'no_longer_overdue', skipped: true });

    expect(
      evaluateRemindOverdueGuards({ ...overdueEntry, assigneeRole: '' }, [], { nowMs }),
    ).toMatchObject({ ok: false, reason: 'missing_assignment', skipped: true });

    expect(
      evaluateRemindOverdueGuards(overdueEntry, ['staff1'], {
        nowMs,
        chatNotifyEnabled: false,
      }),
    ).toMatchObject({ ok: false, reason: 'chat_notify_disabled', skipped: true });
  });
});

describe('getAssigneeRecipientUserIds', () => {
  it('filters by role and store', () => {
    const profiles = [
      {
        userId: 's1',
        role: 'staff',
        approvalStatus: 'approved',
        stores: [{ id: 'store-a' }],
      },
      {
        userId: 's2',
        role: 'staff',
        approvalStatus: 'approved',
        stores: [{ id: 'other' }],
      },
      {
        userId: 'm1',
        role: 'manager',
        approvalStatus: 'approved',
        stores: [{ id: 'store-a' }],
      },
    ];
    expect(getAssigneeRecipientUserIds(overdueEntry, profiles, hasStoreAccess)).toEqual([
      's1',
    ]);
  });
});
