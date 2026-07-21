import { describe, expect, it } from 'vitest';
import {
  canActOnAssignedIssue,
  canOpenLogbook,
  canReviewLogbookIssue,
  canViewLogbookEntry,
  isIssueDueSoon,
  isIssueOverdue,
  isLogbookIssue,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
} from './logbook';
import {
  computeLogbookIssueMetrics,
  countLogbookIssues,
  filterLogbookIssues,
} from './logbookMetrics';
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
    date: partial.date ?? '2026-07-21',
    shift: partial.shift ?? 'AM',
    content: partial.content ?? 'Leak in cooler',
    severity: partial.severity ?? 'warning',
    isAnnouncement: partial.isAnnouncement ?? false,
    requiresAck: partial.requiresAck ?? false,
    ackUserIdsJson: partial.ackUserIdsJson ?? '[]',
    createdAt: partial.createdAt ?? '2026-07-21T08:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-07-21T08:00:00.000Z',
    entryType: partial.entryType,
    assigneeRole: partial.assigneeRole,
    dueAt: partial.dueAt,
    status: partial.status,
    startedAt: partial.startedAt,
    startedByUserId: partial.startedByUserId,
    resolutionNote: partial.resolutionNote,
    resolutionSubmittedAt: partial.resolutionSubmittedAt,
    resolutionSubmittedByUserId: partial.resolutionSubmittedByUserId,
    resolvedAt: partial.resolvedAt,
    resolvedByUserId: partial.resolvedByUserId,
    reviewedAt: partial.reviewedAt,
    reviewedByUserId: partial.reviewedByUserId,
    reviewNote: partial.reviewNote,
  };
}

describe('resolveLogbookEntryType', () => {
  it('uses entryType when present', () => {
    expect(resolveLogbookEntryType(entry({ entryType: 'issue' }))).toBe('issue');
    expect(resolveLogbookEntryType(entry({ entryType: 'note' }))).toBe('note');
  });

  it('falls back to isAnnouncement for legacy rows', () => {
    expect(resolveLogbookEntryType(entry({ isAnnouncement: true }))).toBe('announcement');
    expect(resolveLogbookEntryType(entry({ isAnnouncement: false }))).toBe('note');
  });
});

describe('issue overdue / due soon', () => {
  const now = new Date('2026-07-21T12:00:00.000Z').getTime();

  it('detects overdue unresolved issues', () => {
    const e = entry({
      entryType: 'issue',
      status: 'open',
      dueAt: '2026-07-21T10:00:00.000Z',
    });
    expect(isLogbookIssue(e)).toBe(true);
    expect(isIssueOverdue(e, now)).toBe(true);
    expect(isIssueDueSoon(e, now)).toBe(false);
  });

  it('does not mark resolved as overdue', () => {
    const e = entry({
      entryType: 'issue',
      status: 'resolved',
      dueAt: '2026-07-21T10:00:00.000Z',
    });
    expect(isIssueOverdue(e, now)).toBe(false);
  });

  it('detects due soon within 2h', () => {
    const e = entry({
      entryType: 'issue',
      status: 'in_progress',
      dueAt: '2026-07-21T13:30:00.000Z',
    });
    expect(isIssueDueSoon(e, now)).toBe(true);
    expect(isIssueOverdue(e, now)).toBe(false);
  });
});

describe('visibility and actions', () => {
  const issue = entry({
    entryType: 'issue',
    status: 'open',
    assigneeRole: 'staff',
    storeId: 'store-a',
  });

  it('staff sees only assigned issues at their stores', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    expect(canViewLogbookEntry(staff, issue, defs)).toBe(true);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ entryType: 'note', isAnnouncement: false, storeId: 'store-a' }),
        defs,
      ),
    ).toBe(false);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ ...issue, storeId: 'other', assigneeRole: 'staff' }),
        defs,
      ),
    ).toBe(false);
  });

  it('ops tools can view store-scoped notes', () => {
    const leader = profile({ userId: 'l1', role: 'leader' });
    expect(
      canViewLogbookEntry(
        leader,
        entry({ entryType: 'note', storeId: 'store-a' }),
        defs,
      ),
    ).toBe(true);
  });

  it('canOpenLogbook for ops or assigned issues', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    expect(canOpenLogbook(staff, defs, false)).toBe(false);
    expect(canOpenLogbook(staff, defs, true)).toBe(true);
    expect(canOpenLogbook(profile({ userId: 'l1', role: 'leader' }), defs, false)).toBe(true);
  });

  it('assignee can act; higher-rank reviewer can review', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    const manager = profile({ userId: 'm1', role: 'manager' });
    expect(canActOnAssignedIssue(staff, issue, defs)).toBe(true);
    expect(canActOnAssignedIssue(manager, issue, defs)).toBe(false);

    const waiting = entry({
      ...issue,
      status: 'waiting_approval',
      resolutionSubmittedByUserId: 's1',
    });
    expect(canReviewLogbookIssue(manager, waiting, defs)).toBe(true);
    expect(canReviewLogbookIssue(staff, waiting, defs)).toBe(false);
    expect(
      canReviewLogbookIssue(
        profile({ userId: 's1', role: 'manager' }),
        waiting,
        defs,
      ),
    ).toBe(false);
  });

  it('reviewer must outrank assigneeRole (lower rank number)', () => {
    const leaderIssue = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'leader',
      resolutionSubmittedByUserId: 'x',
    });
    // subleader rank is below leader? staff < subleader < leader < manager in authority
    // rankOf: lower number = higher authority. leader reviews staff, not vice versa.
    const subleader = profile({ userId: 'sl', role: 'subleader' });
    const areaManager = profile({ userId: 'am', role: 'areaManager' });
    expect(canReviewLogbookIssue(subleader, leaderIssue, defs)).toBe(false);
    expect(canReviewLogbookIssue(areaManager, leaderIssue, defs)).toBe(true);
  });
});

describe('logbook metrics', () => {
  const issues: LogbookEntry[] = [
    entry({
      id: '1',
      entryType: 'issue',
      status: 'open',
      dueAt: '2026-07-20T10:00:00.000Z',
      date: '2026-07-20',
    }),
    entry({
      id: '2',
      entryType: 'issue',
      status: 'resolved',
      dueAt: '2026-07-21T18:00:00.000Z',
      resolvedAt: '2026-07-21T16:00:00.000Z',
      startedAt: '2026-07-21T10:00:00.000Z',
      resolutionSubmittedAt: '2026-07-21T14:00:00.000Z',
      reviewedAt: '2026-07-21T16:00:00.000Z',
      createdAt: '2026-07-21T09:00:00.000Z',
      date: '2026-07-21',
    }),
    entry({
      id: '3',
      entryType: 'note',
      date: '2026-07-21',
    }),
  ];

  it('filters to issues only and counts statuses', () => {
    const filtered = filterLogbookIssues(issues, { fromYmd: '2026-07-20', toYmd: '2026-07-21' });
    expect(filtered).toHaveLength(2);
    const now = new Date('2026-07-21T12:00:00.000Z').getTime();
    const counts = countLogbookIssues(filtered, now);
    expect(counts.open).toBe(1);
    expect(counts.resolved).toBe(1);
    expect(counts.overdue).toBe(1);
  });

  it('computes resolution and on-time rates', () => {
    const filtered = filterLogbookIssues(issues);
    const now = new Date('2026-07-22T12:00:00.000Z').getTime();
    const metrics = computeLogbookIssueMetrics(filtered, now);
    expect(metrics.counts.total).toBe(2);
    expect(metrics.onTimeResolutionRate).toBe(100);
    expect(metrics.avgResolutionDurationMs).toBeGreaterThan(0);
    expect(resolveLogbookIssueStatus(filtered[0]!)).toBe('open');
  });
});
