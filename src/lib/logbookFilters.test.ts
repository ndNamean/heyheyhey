import { describe, expect, it } from 'vitest';
import {
  canSeeMyTeamQuickView,
  clearIncompatibleFiltersOnEntryTypeChange,
  countActiveDetailedFilters,
  emptyLogbookFilterState,
  entryMatchesLogbookFilters,
  isMyTeamLogbookIssue,
  listActiveDetailedFilterChips,
  needsMyLogbookAction,
  parseLogbookInitialFilter,
  defaultLogbookQuickView,
} from './logbookFilters';
import { isIssueOverdue } from './logbook';
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
    resolutionProofType: partial.resolutionProofType,
    resolutionRequirement: partial.resolutionRequirement,
    resolutionChecked: partial.resolutionChecked,
    resolutionNumber: partial.resolutionNumber,
    resolutionNote: partial.resolutionNote,
    resolutionSubmittedAt: partial.resolutionSubmittedAt,
    resolutionSubmittedByUserId: partial.resolutionSubmittedByUserId,
    resolutionAttemptId: partial.resolutionAttemptId,
    resolvedAt: partial.resolvedAt,
    resolvedByUserId: partial.resolvedByUserId,
    reviewedAt: partial.reviewedAt,
    reviewedByUserId: partial.reviewedByUserId,
    reviewNote: partial.reviewNote,
    store: partial.store,
  };
}

describe('logbookFilters', () => {
  const now = new Date('2026-07-22T12:00:00.000Z').getTime();

  it('overdue matches isIssueOverdue (due passed, not Resolved/Recalled)', () => {
    const overdue = entry({
      entryType: 'issue',
      status: 'open',
      dueAt: '2026-07-21T10:00:00.000Z',
      assigneeRole: 'staff',
    });
    const resolved = entry({
      entryType: 'issue',
      status: 'resolved',
      dueAt: '2026-07-21T10:00:00.000Z',
      assigneeRole: 'staff',
    });
    expect(isIssueOverdue(overdue, now)).toBe(true);
    expect(isIssueOverdue(resolved, now)).toBe(false);

    const filters = emptyLogbookFilterState();
    filters.issueLifecycles = ['overdue'];
    const staff = profile({ role: 'staff', userId: 'u1' });
    expect(entryMatchesLogbookFilters(overdue, staff, defs, filters, { now })).toBe(true);
    expect(entryMatchesLogbookFilters(resolved, staff, defs, filters, { now })).toBe(false);
  });

  it('Active lifecycle includes open, in_progress, waiting_approval, correction', () => {
    const filters = emptyLogbookFilterState();
    filters.issueLifecycles = ['active'];
    const staff = profile({ role: 'staff', userId: 'u1' });

    expect(
      entryMatchesLogbookFilters(
        entry({ entryType: 'issue', status: 'open', assigneeRole: 'staff' }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(true);
    expect(
      entryMatchesLogbookFilters(
        entry({ entryType: 'issue', status: 'in_progress', assigneeRole: 'staff' }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(true);
    expect(
      entryMatchesLogbookFilters(
        entry({ entryType: 'issue', status: 'waiting_approval', assigneeRole: 'staff' }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(true);
    expect(
      entryMatchesLogbookFilters(
        entry({
          entryType: 'issue',
          status: 'in_progress',
          reviewNote: 'Fix seal',
          assigneeRole: 'staff',
        }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(true);
    expect(
      entryMatchesLogbookFilters(
        entry({ entryType: 'issue', status: 'resolved', assigneeRole: 'staff' }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(false);
  });

  it('needs my action: assigned work, waiting review, incomplete setup', () => {
    const staff = profile({ role: 'staff', userId: 'staff1' });
    const manager = profile({ role: 'manager', userId: 'mgr1' });

    const assignedOpen = entry({
      entryType: 'issue',
      status: 'open',
      assigneeRole: 'staff',
      resolutionProofType: 'photo',
      dueAt: '2026-07-25T10:00:00.000Z',
    });
    expect(needsMyLogbookAction(staff, assignedOpen, defs)).toBe(true);

    const waiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'staff',
      resolutionProofType: 'photo',
      dueAt: '2026-07-25T10:00:00.000Z',
      resolutionSubmittedByUserId: 'staff1',
    });
    expect(needsMyLogbookAction(manager, waiting, defs)).toBe(true);
    expect(needsMyLogbookAction(staff, waiting, defs)).toBe(false);

    const incomplete = entry({
      entryType: 'issue',
      status: 'open',
      assigneeRole: '',
      authorUserId: 'mgr1',
      dueAt: '',
    });
    expect(needsMyLogbookAction(manager, incomplete, defs)).toBe(true);
  });

  it('gates My team quick view to manager+', () => {
    expect(canSeeMyTeamQuickView(profile({ role: 'manager', userId: 'm' }), defs)).toBe(true);
    expect(canSeeMyTeamQuickView(profile({ role: 'owner', userId: 'o' }), defs)).toBe(true);
    expect(canSeeMyTeamQuickView(profile({ role: 'leader', userId: 'l' }), defs)).toBe(false);
    expect(canSeeMyTeamQuickView(profile({ role: 'staff', userId: 's' }), defs)).toBe(false);

    const mgr = profile({ role: 'manager', userId: 'm' });
    const staffIssue = entry({ entryType: 'issue', assigneeRole: 'staff', status: 'open' });
    const mgrIssue = entry({ entryType: 'issue', assigneeRole: 'manager', status: 'open' });
    expect(isMyTeamLogbookIssue(mgr, staffIssue, defs)).toBe(true);
    expect(isMyTeamLogbookIssue(mgr, mgrIssue, defs)).toBe(false);
  });

  it('store filter keeps all-stores notes/announcements', () => {
    const filters = emptyLogbookFilterState();
    filters.storeId = 'store-a';
    const mgr = profile({ role: 'manager', userId: 'm' });
    const noteAll = entry({ entryType: 'note', storeId: '', content: 'All stores note' });
    const noteOther = entry({ entryType: 'note', storeId: 'other', content: 'Other' });
    const issue = entry({ entryType: 'issue', storeId: 'store-a', assigneeRole: 'staff' });

    expect(entryMatchesLogbookFilters(noteAll, mgr, defs, filters, { now })).toBe(true);
    expect(entryMatchesLogbookFilters(noteOther, mgr, defs, filters, { now })).toBe(false);
    expect(entryMatchesLogbookFilters(issue, mgr, defs, filters, { now })).toBe(true);
  });

  it('entry type change clears incompatible detailed filters', () => {
    const base = emptyLogbookFilterState();
    base.issueLifecycles = ['open', 'overdue'];
    base.assigneeRoles = ['staff'];
    base.proofTypes = ['photo'];
    base.ackStatuses = ['requires_ack'];
    base.dateBasedOn = 'due';

    const toNote = clearIncompatibleFiltersOnEntryTypeChange(base, 'note');
    expect(toNote.issueLifecycles).toEqual([]);
    expect(toNote.assigneeRoles).toEqual([]);
    expect(toNote.proofTypes).toEqual([]);
    expect(toNote.dateBasedOn).toBe('created');
    expect(toNote.ackStatuses).toEqual(['requires_ack']);

    const toIssue = clearIncompatibleFiltersOnEntryTypeChange(base, 'issue');
    expect(toIssue.ackStatuses).toEqual([]);
    expect(toIssue.issueLifecycles).toEqual(['open', 'overdue']);
  });

  it('chip count matches detailed filters only', () => {
    const filters = emptyLogbookFilterState();
    filters.search = 'leak';
    filters.storeId = 'store-a';
    filters.issueLifecycles = ['active', 'overdue'];
    filters.severities = ['critical'];
    filters.dateBasedOn = 'due';
    expect(countActiveDetailedFilters(filters)).toBe(4);
    expect(listActiveDetailedFilterChips(filters)).toHaveLength(4);
  });

  it('OR within field and AND across fields', () => {
    const filters = emptyLogbookFilterState();
    filters.issueLifecycles = ['open', 'resolved'];
    filters.severities = ['critical'];
    const staff = profile({ role: 'staff', userId: 'u1' });

    const openCritical = entry({
      entryType: 'issue',
      status: 'open',
      severity: 'critical',
      assigneeRole: 'staff',
    });
    const openWarning = entry({
      entryType: 'issue',
      status: 'open',
      severity: 'warning',
      assigneeRole: 'staff',
    });
    const resolvedCritical = entry({
      entryType: 'issue',
      status: 'resolved',
      severity: 'critical',
      assigneeRole: 'staff',
    });
    const inProgressCritical = entry({
      entryType: 'issue',
      status: 'in_progress',
      severity: 'critical',
      assigneeRole: 'staff',
    });

    expect(entryMatchesLogbookFilters(openCritical, staff, defs, filters, { now })).toBe(true);
    expect(entryMatchesLogbookFilters(resolvedCritical, staff, defs, filters, { now })).toBe(true);
    expect(entryMatchesLogbookFilters(openWarning, staff, defs, filters, { now })).toBe(false);
    expect(entryMatchesLogbookFilters(inProgressCritical, staff, defs, filters, { now })).toBe(
      false,
    );
  });

  it('maps legacy LOGBOOK_FILTER_KEY values', () => {
    expect(parseLogbookInitialFilter('my-assigned')).toEqual({
      quickView: 'assigned_to_my_role',
    });
    expect(parseLogbookInitialFilter('all')).toEqual({ quickView: 'all_visible' });
    expect(parseLogbookInitialFilter('overdue')).toEqual({
      quickView: 'all_visible',
      issueLifecycles: ['overdue'],
    });
    expect(parseLogbookInitialFilter('correction')).toEqual({
      quickView: 'all_visible',
      issueLifecycles: ['correction_requested'],
    });
  });

  it('defaultLogbookQuickView by role', () => {
    expect(defaultLogbookQuickView(profile({ role: 'staff', userId: 's' }), defs)).toBe(
      'assigned_to_my_role',
    );
    expect(defaultLogbookQuickView(profile({ role: 'hybrid', userId: 'h' }), defs)).toBe(
      'assigned_to_my_role',
    );
    expect(defaultLogbookQuickView(profile({ role: 'manager', userId: 'm' }), defs)).toBe(
      'needs_my_action',
    );
    expect(defaultLogbookQuickView(profile({ role: 'leader', userId: 'l' }), defs)).toBe(
      'all_visible',
    );
  });

  it('search matches content and store code', () => {
    const filters = emptyLogbookFilterState();
    filters.search = 'tkc';
    const staff = profile({ role: 'staff', userId: 'u1' });
    const withStore = entry({
      entryType: 'note',
      content: 'Hello',
      store: storeA,
    });
    const storeById = new Map([['store-a', storeA]]);
    expect(
      entryMatchesLogbookFilters(withStore, staff, defs, filters, { now, storeById }),
    ).toBe(true);
    filters.search = 'seal';
    expect(
      entryMatchesLogbookFilters(
        entry({ entryType: 'issue', content: 'Broken seal', assigneeRole: 'staff' }),
        staff,
        defs,
        filters,
        { now },
      ),
    ).toBe(true);
  });
});
