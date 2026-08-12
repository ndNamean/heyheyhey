// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  db: {
    queryOnce: vi.fn(async () => ({ data: {} })),
    getAuth: vi.fn(async () => null),
  },
}));

vi.mock('../lib/avatarClient', () => ({
  resolveAvatar: vi.fn(async () => ({ url: '', repaired: false })),
}));

import { defaultDefinitionsAsEntities } from '../lib/roleResolver';
import type { LogbookEntry, Profile, Store } from '../types';
import LogbookAssigneeRoster from './LogbookAssigneeRoster';

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

const copy = {
  assigneeNotSubmitted: 'Not submitted',
  assigneeSubmitted: 'Submitted',
  assigneeWaitingApproval: 'Waiting approval',
  assigneeCorrection: 'Correction requested',
  assigneeApproved: 'Approved',
  assigneeRosterSummary: 'Submitted {done}/{total}',
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
    authorUserId: 'author',
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
    assigneeUserIdsJson: partial.assigneeUserIdsJson ?? '["staff-1","staff-2"]',
    dueAt: '2026-08-10T10:00:00.000Z',
    status: partial.status ?? 'open',
    ...partial,
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(hover: hover) and (pointer: fine)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

describe('LogbookAssigneeRoster', () => {
  const staff1 = profile({ userId: 'staff-1', role: 'staff', displayName: 'Sam Staff' });
  const staff2 = profile({ userId: 'staff-2', role: 'staff', displayName: 'Pat Staff' });

  it('shows waiting approval for the submitter and not submitted for others', () => {
    render(
      <LogbookAssigneeRoster
        entry={entry({
          status: 'waiting_approval',
          resolutionSubmittedByUserId: 'staff-1',
        })}
        profiles={[staff1, staff2]}
        defs={defs}
        copy={copy}
      />,
    );
    expect(screen.getByTestId('logbook-assignee-roster-summary').textContent).toBe('Submitted 1/2');
    expect(screen.getByTestId('logbook-assignee-roster-state-staff-1').textContent).toBe(
      'Waiting approval',
    );
    expect(screen.getByTestId('logbook-assignee-roster-state-staff-2').textContent).toBe(
      'Not submitted',
    );
    expect(screen.getByText('Sam Staff')).toBeTruthy();
    expect(screen.getByText('Pat Staff')).toBeTruthy();
  });

  it('caps role-wide lists above 8 with +K more', () => {
    const profiles = Array.from({ length: 10 }, (_, i) =>
      profile({ userId: `s${i}`, role: 'staff', displayName: `Staff ${String(i).padStart(2, '0')}` }),
    );
    render(
      <LogbookAssigneeRoster
        entry={entry({ assigneeUserIdsJson: '[]', assigneeRole: 'staff' })}
        profiles={profiles}
        defs={defs}
        copy={copy}
      />,
    );
    expect(screen.getAllByTestId('logbook-assignee-roster-row')).toHaveLength(8);
    expect(screen.getByTestId('logbook-assignee-roster-more').textContent).toBe('+2');
    expect(screen.getByTestId('logbook-assignee-roster-summary').textContent).toBe('Submitted 0/10');
  });
});
