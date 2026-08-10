import { describe, expect, it } from 'vitest';
import {
  canRemindOverdueToStoreChat,
  listLogbookAssigneeMentionLabels,
  listLogbookAssigneeRecipientUserIds,
  overdueChatRemindState,
} from './logbookOverdueRemind';
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

function entry(partial: Partial<LogbookEntry> = {}): LogbookEntry {
  return {
    id: partial.id ?? 'e1',
    storeId: partial.storeId ?? 'store-a',
    authorUserId: partial.authorUserId ?? 'author',
    date: '2026-08-10',
    shift: 'AM',
    content: 'Leak',
    severity: 'warning',
    isAnnouncement: false,
    requiresAck: false,
    ackUserIdsJson: '[]',
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
    entryType: 'issue',
    assigneeRole: partial.assigneeRole ?? 'staff',
    assigneeUserIdsJson: partial.assigneeUserIdsJson ?? '[]',
    dueAt: partial.dueAt ?? '2026-08-10T10:00:00.000Z',
    status: partial.status ?? 'open',
    overdueChatRemindedAt: partial.overdueChatRemindedAt ?? '',
    ...partial,
  };
}

const now = Date.parse('2026-08-10T12:00:00.000Z');

describe('overdueChatRemindState', () => {
  it('returns unassigned when role or recipients missing', () => {
    expect(overdueChatRemindState(entry({ assigneeRole: '' }), 0, now)).toBe('unassigned');
    expect(overdueChatRemindState(entry({ assigneeRole: 'staff' }), 0, now)).toBe('unassigned');
  });

  it('returns not_reminded / reminded for assigned overdue', () => {
    expect(overdueChatRemindState(entry(), 2, now)).toBe('not_reminded');
    expect(
      overdueChatRemindState(entry({ overdueChatRemindedAt: '2026-08-10T11:00:00.000Z' }), 2, now),
    ).toBe('reminded');
  });

  it('returns not_eligible_status when resolved or not overdue', () => {
    expect(overdueChatRemindState(entry({ status: 'resolved' }), 1, now)).toBe(
      'not_eligible_status',
    );
    expect(
      overdueChatRemindState(entry({ dueAt: '2026-08-10T18:00:00.000Z' }), 1, now),
    ).toBe('not_eligible_status');
  });
});

describe('canRemindOverdueToStoreChat', () => {
  const overdue = entry();

  it('allows manager / upper review; blocks assignee and staff', () => {
    const manager = profile({ userId: 'mgr', role: 'manager' });
    const owner = profile({ userId: 'own', role: 'owner' });
    const staff = profile({ userId: 'staff1', role: 'staff' });
    expect(canRemindOverdueToStoreChat(manager, overdue, defs, now)).toBe(true);
    expect(canRemindOverdueToStoreChat(owner, overdue, defs, now)).toBe(true);
    expect(canRemindOverdueToStoreChat(staff, overdue, defs, now)).toBe(false);
  });

  it('blocks when not overdue', () => {
    const manager = profile({ userId: 'mgr', role: 'manager' });
    expect(
      canRemindOverdueToStoreChat(
        manager,
        entry({ dueAt: '2026-08-10T18:00:00.000Z' }),
        defs,
        now,
      ),
    ).toBe(false);
  });
});

describe('listLogbookAssigneeMentionLabels', () => {
  it('lists matching assignee display names', () => {
    const profiles = [
      profile({ userId: 's1', role: 'staff', displayName: 'Ada' }),
      profile({ userId: 's2', role: 'staff', displayName: 'Bob' }),
      profile({ userId: 'm1', role: 'manager', displayName: 'Meg' }),
    ];
    expect(listLogbookAssigneeMentionLabels(entry(), profiles, defs)).toEqual(['Ada', 'Bob']);
    expect(listLogbookAssigneeRecipientUserIds(entry(), profiles, defs).sort()).toEqual([
      's1',
      's2',
    ]);
  });
});
