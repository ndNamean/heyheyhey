import { describe, expect, it } from 'vitest';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { LogbookEntry, Profile, Store } from '../types';
import {
  DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY,
  buildLogbookAssigneeRoster,
  formatLogbookAssigneeRosterLine,
  resolveLogbookAssigneeRosterState,
  shouldIncludeLogbookAssigneeRosterNotify,
} from './logbookAssigneeRoster';

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
    assigneeUserIdsJson: partial.assigneeUserIdsJson ?? '["le","phung","linh","khanh"]',
    dueAt: partial.dueAt ?? '2026-08-10T10:00:00.000Z',
    status: partial.status ?? 'open',
    ...partial,
  };
}

const le = profile({ userId: 'le', role: 'staff', displayName: 'Lê' });
const phung = profile({ userId: 'phung', role: 'staff', displayName: 'Phụng' });
const linh = profile({ userId: 'linh', role: 'staff', displayName: 'Linh' });
const khanh = profile({ userId: 'khanh', role: 'staff', displayName: 'Khánh' });
const profiles = [le, phung, linh, khanh];

function statesByUser(rows: ReturnType<typeof buildLogbookAssigneeRoster>) {
  return Object.fromEntries(rows.map((r) => [r.userId, r.state]));
}

describe('resolveLogbookAssigneeRosterState', () => {
  it('returns not_submitted when there is no submitter', () => {
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'le',
        submitterId: '',
        status: 'waiting_approval',
      }),
    ).toBe('not_submitted');
  });

  it('overlays issue status on the submitter only', () => {
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'le',
        submitterId: 'le',
        status: 'waiting_approval',
      }),
    ).toBe('waiting_approval');
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'le',
        submitterId: 'le',
        status: 'resolved',
      }),
    ).toBe('approved');
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'le',
        submitterId: 'le',
        status: 'in_progress',
        reviewNote: 'Please retake photo',
      }),
    ).toBe('correction');
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'le',
        submitterId: 'le',
        status: 'in_progress',
      }),
    ).toBe('submitted');
    expect(
      resolveLogbookAssigneeRosterState({
        userId: 'phung',
        submitterId: 'le',
        status: 'waiting_approval',
      }),
    ).toBe('not_submitted');
  });
});

describe('buildLogbookAssigneeRoster', () => {
  it('marks everyone not_submitted when there is no submitter', () => {
    const rows = buildLogbookAssigneeRoster(entry({ status: 'open' }), profiles, defs);
    expect(rows).toHaveLength(4);
    expect(statesByUser(rows)).toEqual({
      le: 'not_submitted',
      phung: 'not_submitted',
      linh: 'not_submitted',
      khanh: 'not_submitted',
    });
  });

  it('marks one of N as waiting_approval and the rest not_submitted', () => {
    const rows = buildLogbookAssigneeRoster(
      entry({
        status: 'waiting_approval',
        resolutionSubmittedByUserId: 'le',
      }),
      profiles,
      defs,
    );
    expect(statesByUser(rows)).toEqual({
      le: 'waiting_approval',
      phung: 'not_submitted',
      linh: 'not_submitted',
      khanh: 'not_submitted',
    });
  });

  it('marks the submitter approved when the issue is resolved', () => {
    const rows = buildLogbookAssigneeRoster(
      entry({
        status: 'resolved',
        resolutionSubmittedByUserId: 'linh',
      }),
      profiles,
      defs,
    );
    expect(statesByUser(rows).linh).toBe('approved');
    expect(statesByUser(rows).le).toBe('not_submitted');
  });

  it('marks correction when in_progress with a review note', () => {
    const rows = buildLogbookAssigneeRoster(
      entry({
        status: 'in_progress',
        reviewNote: 'Fix the seal photo',
        resolutionSubmittedByUserId: 'phung',
      }),
      profiles,
      defs,
    );
    expect(statesByUser(rows).phung).toBe('correction');
    expect(statesByUser(rows).khanh).toBe('not_submitted');
  });

  it('returns empty when there are no assignee recipients', () => {
    expect(
      buildLogbookAssigneeRoster(
        entry({ assigneeRole: '', assigneeUserIdsJson: '[]' }),
        profiles,
        defs,
      ),
    ).toEqual([]);
    expect(
      buildLogbookAssigneeRoster(
        entry({ assigneeUserIdsJson: '[]', assigneeRole: 'staff', storeId: '' }),
        profiles,
        defs,
      ),
    ).toEqual([]);
  });

  it('expands role-wide [] via listLogbookAssigneeRecipientUserIds', () => {
    const rows = buildLogbookAssigneeRoster(
      entry({
        assigneeUserIdsJson: '[]',
        status: 'waiting_approval',
        resolutionSubmittedByUserId: 'le',
      }),
      profiles,
      defs,
    );
    expect(rows.map((r) => r.userId).sort()).toEqual(['khanh', 'le', 'linh', 'phung']);
    expect(statesByUser(rows).le).toBe('waiting_approval');
    expect(statesByUser(rows).phung).toBe('not_submitted');
  });
});

describe('formatLogbookAssigneeRosterLine', () => {
  it('formats submitted vs not submitted names', () => {
    const rows = buildLogbookAssigneeRoster(
      entry({
        status: 'waiting_approval',
        resolutionSubmittedByUserId: 'le',
      }),
      profiles,
      defs,
    );
    expect(formatLogbookAssigneeRosterLine(rows, DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY)).toBe(
      'Submitted: Lê · Not submitted: Khánh, Linh, Phụng',
    );
  });

  it('omits empty sides and skips empty rows', () => {
    const pendingOnly = buildLogbookAssigneeRoster(entry({ status: 'open' }), profiles, defs);
    expect(formatLogbookAssigneeRosterLine(pendingOnly)).toBe(
      'Not submitted: Khánh, Lê, Linh, Phụng',
    );
    expect(formatLogbookAssigneeRosterLine([])).toBe('');
  });

  it('gates notify inclusion for empty / single-assignee noise', () => {
    const multi = buildLogbookAssigneeRoster(entry({ status: 'open' }), profiles, defs);
    expect(shouldIncludeLogbookAssigneeRosterNotify(multi, '')).toBe(true);
    const single = buildLogbookAssigneeRoster(
      entry({ assigneeUserIdsJson: '["le"]', status: 'open' }),
      profiles,
      defs,
    );
    expect(shouldIncludeLogbookAssigneeRosterNotify(single, '')).toBe(false);
    expect(shouldIncludeLogbookAssigneeRosterNotify(single, 'le')).toBe(true);
    expect(shouldIncludeLogbookAssigneeRosterNotify([], 'le')).toBe(false);
  });
});
