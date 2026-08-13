import { describe, expect, it, vi } from 'vitest';
import {
  canActOnAssignedIssue,
  canHardDeleteLogbookIssue,
  canOpenLogbook,
  canRecallLogbookIssue,
  canReviewLogbookIssue,
  canSubmitResolutionNow,
  canViewLogbookEntry,
  dueAtHoursFromNow,
  eligibleAssigneeUsers,
  eligibleLogbookAssigneeRoles,
  getIssueConfigurationState,
  hasMyLogbookAck,
  isIssueDueSoon,
  isIssueOverdue,
  isLogbookIssue,
  isPristineLogbookIssue,
  isStaffOrHybrid,
  listNotesAnnouncementsForHome,
  parseAssigneeUserIds,
  parseLogbookAckUserIds,
  profileMatchesAssignee,
  resolveLogbookAckPeople,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
  resolveResolutionMedia,
  resolveResolutionProofs,
  resolveSourceMedia,
  serializeAssigneeUserIds,
  splitNotesAnnouncementsForHome,
  toDatetimeLocalValue,
} from './logbook';
import {
  buildLogbookNoteAnnouncementNotifications,
  getLogbookAssigneeRecipients,
  getNoteAnnouncementRecipients,
} from './notifications';
import {
  computeLogbookIssueMetrics,
  countLogbookIssues,
  filterLogbookIssues,
} from './logbookMetrics';
import {
  canSubmitResolutionDraft,
  emptyResolutionDraft,
  hasCorrectionFeedback,
  isSameResolutionAttempt,
  resolveLogbookProofType,
} from './logbookResolution';
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
    assigneeUserIdsJson: partial.assigneeUserIdsJson,
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
    photo: partial.photo,
    sourceMedia: partial.sourceMedia,
    resolutionMedia: partial.resolutionMedia,
    resolutionProofHistory: partial.resolutionProofHistory,
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

describe('due datetime-local helpers', () => {
  it('formats local wall clock as YYYY-MM-DDTHH:mm', () => {
    const now = new Date(2026, 6, 21, 14, 5, 59, 999);
    expect(toDatetimeLocalValue(now)).toBe('2026-07-21T14:05');
  });

  it('adds 12 and 24 hours from a frozen now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 8, 0, 0, 0));
    try {
      const now = new Date();
      expect(dueAtHoursFromNow(12, now)).toBe('2026-07-21T20:00');
      expect(dueAtHoursFromNow(24, now)).toBe('2026-07-22T08:00');
      expect(dueAtHoursFromNow(12)).toBe('2026-07-21T20:00');
      expect(dueAtHoursFromNow(24)).toBe('2026-07-22T08:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls over midnight and the calendar day', () => {
    const nearMidnight = new Date(2026, 6, 21, 20, 30, 0, 0);
    expect(dueAtHoursFromNow(12, nearMidnight)).toBe('2026-07-22T08:30');
    expect(dueAtHoursFromNow(24, nearMidnight)).toBe('2026-07-22T20:30');

    const justBeforeMidnight = new Date(2026, 6, 21, 23, 45, 0, 0);
    expect(dueAtHoursFromNow(12, justBeforeMidnight)).toBe('2026-07-22T11:45');
    expect(dueAtHoursFromNow(24, justBeforeMidnight)).toBe('2026-07-22T23:45');

    const monthEnd = new Date(2026, 0, 31, 20, 0, 0, 0);
    expect(dueAtHoursFromNow(12, monthEnd)).toBe('2026-02-01T08:00');
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

  it('does not mark resolved or recalled as overdue', () => {
    expect(
      isIssueOverdue(
        entry({
          entryType: 'issue',
          status: 'resolved',
          dueAt: '2026-07-21T10:00:00.000Z',
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isIssueOverdue(
        entry({
          entryType: 'issue',
          status: 'recalled',
          dueAt: '2026-07-21T10:00:00.000Z',
        }),
        now,
      ),
    ).toBe(false);
  });

  it('no overdue when dueAt missing', () => {
    expect(
      isIssueOverdue(
        entry({ entryType: 'issue', status: 'open', dueAt: '' }),
        now,
      ),
    ).toBe(false);
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

describe('legacy configuration', () => {
  it('flags missing assignment / deadline', () => {
    expect(
      getIssueConfigurationState(
        entry({ entryType: 'issue', assigneeRole: '', dueAt: '2026-07-21T10:00:00.000Z' }),
      ),
    ).toBe('missing_assignment');
    expect(
      getIssueConfigurationState(
        entry({ entryType: 'issue', assigneeRole: 'staff', dueAt: '' }),
      ),
    ).toBe('missing_deadline');
    expect(
      getIssueConfigurationState(
        entry({
          entryType: 'issue',
          assigneeRole: 'staff',
          dueAt: '2026-07-21T10:00:00.000Z',
          resolutionProofType: 'photo',
        }),
      ),
    ).toBe('ready');
  });

  it('blocks staff actions without assignee', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    const incomplete = entry({
      entryType: 'issue',
      status: 'open',
      assigneeRole: '',
      storeId: 'store-a',
    });
    expect(canActOnAssignedIssue(staff, incomplete, defs)).toBe(false);
  });
});

describe('visibility and actions', () => {
  const issue = entry({
    entryType: 'issue',
    status: 'open',
    assigneeRole: 'staff',
    storeId: 'store-a',
  });

  it('staff sees assigned issues and store-scoped notes; not other-store issues', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    expect(canViewLogbookEntry(staff, issue, defs)).toBe(true);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ entryType: 'note', isAnnouncement: false, storeId: 'store-a' }),
        defs,
      ),
    ).toBe(true);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ entryType: 'note', isAnnouncement: false, storeId: '' }),
        defs,
      ),
    ).toBe(true);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ entryType: 'announcement', isAnnouncement: true, storeId: 'store-a' }),
        defs,
      ),
    ).toBe(true);
    expect(
      canViewLogbookEntry(
        staff,
        entry({ entryType: 'note', storeId: 'other' }),
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

  it('viewer never sees notes or announcements', () => {
    const viewer = profile({ userId: 'v1', role: 'viewer' });
    expect(
      canViewLogbookEntry(
        viewer,
        entry({ entryType: 'note', storeId: 'store-a' }),
        defs,
      ),
    ).toBe(false);
    expect(
      canViewLogbookEntry(
        viewer,
        entry({ entryType: 'announcement', isAnnouncement: true, storeId: '' }),
        defs,
      ),
    ).toBe(false);
  });

  it('hybrid sees all-store and assigned-store notes', () => {
    const hybrid = profile({ userId: 'h1', role: 'hybrid' });
    expect(
      canViewLogbookEntry(hybrid, entry({ entryType: 'note', storeId: '' }), defs),
    ).toBe(true);
    expect(
      canViewLogbookEntry(hybrid, entry({ entryType: 'note', storeId: 'store-a' }), defs),
    ).toBe(true);
    expect(
      canViewLogbookEntry(hybrid, entry({ entryType: 'note', storeId: 'other' }), defs),
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

  it('canOpenLogbook for ops, reviewers, or assigned issues', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    expect(canOpenLogbook(staff, defs, false)).toBe(false);
    expect(canOpenLogbook(staff, defs, true)).toBe(true);
    expect(canOpenLogbook(profile({ userId: 'l1', role: 'leader' }), defs, false)).toBe(true);
    expect(canOpenLogbook(profile({ userId: 'h1', role: 'hybrid' }), defs, false)).toBe(true);
  });

  it('eligibleLogbookAssigneeRoles filters strictly lower roles', () => {
    expect(eligibleLogbookAssigneeRoles('owner', defs)).toEqual([
      'areaManager',
      'manager',
      'leader',
      'subleader',
      'hybrid',
      'staff',
    ]);
    expect(eligibleLogbookAssigneeRoles('manager', defs)).toEqual([
      'leader',
      'subleader',
      'hybrid',
      'staff',
    ]);
    expect(eligibleLogbookAssigneeRoles('subleader', defs)).toEqual(['hybrid', 'staff']);
    expect(eligibleLogbookAssigneeRoles('leader', defs)).toEqual([
      'subleader',
      'hybrid',
      'staff',
    ]);
    expect(eligibleLogbookAssigneeRoles('hybrid', defs)).toEqual(['staff']);
    expect(eligibleLogbookAssigneeRoles('staff', defs)).toEqual([]);
    expect(eligibleLogbookAssigneeRoles('viewer', defs)).toEqual([]);
  });

  it('eligibleLogbookAssigneeRoles ignores corrupted live ranks', () => {
    const badDefs = defs.map((d) =>
      d.key === 'subleader' ? { ...d, rank: 0 } : d.key === 'manager' ? { ...d, rank: 9 } : d,
    );
    // Even if Instant ranks say subleader is "owner-level", matrix still blocks manager
    expect(eligibleLogbookAssigneeRoles('subleader', badDefs)).toEqual(['hybrid', 'staff']);
    expect(eligibleLogbookAssigneeRoles('subleader', badDefs)).not.toContain('manager');
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

  it('owner/author can approve Staff submitter when not the submitter', () => {
    const ownerAuthor = profile({ userId: 'author', role: 'owner' });
    const waiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'staff',
      authorUserId: 'author',
      resolutionSubmittedByUserId: 's1',
    });
    expect(canReviewLogbookIssue(ownerAuthor, waiting, defs)).toBe(true);
  });

  it('reviewer must outrank assigneeRole (lower rank number)', () => {
    const leaderIssue = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'leader',
      resolutionSubmittedByUserId: 'x',
    });
    const subleader = profile({ userId: 'sl', role: 'subleader' });
    const areaManager = profile({ userId: 'am', role: 'areaManager' });
    expect(canReviewLogbookIssue(subleader, leaderIssue, defs)).toBe(false);
    expect(canReviewLogbookIssue(areaManager, leaderIssue, defs)).toBe(true);
  });

  it('hybrid can review staff issues; staff cannot review hybrid', () => {
    const staffWaiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'staff',
      resolutionSubmittedByUserId: 's1',
    });
    const hybridWaiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'hybrid',
      resolutionSubmittedByUserId: 'submitter',
    });
    const hybrid = profile({ userId: 'h-reviewer', role: 'hybrid' });
    const staff = profile({ userId: 's-reviewer', role: 'staff' });
    const subleader = profile({ userId: 'sl', role: 'subleader' });

    expect(canReviewLogbookIssue(hybrid, staffWaiting, defs)).toBe(true);
    expect(canReviewLogbookIssue(staff, hybridWaiting, defs)).toBe(false);
    expect(canReviewLogbookIssue(subleader, hybridWaiting, defs)).toBe(true);
    expect(canReviewLogbookIssue(hybrid, hybridWaiting, defs)).toBe(false);
  });
});

describe('recall and delete', () => {
  it('author recalls only pristine open', () => {
    const author = profile({ userId: 'author', role: 'manager' });
    const pristine = entry({
      entryType: 'issue',
      status: 'open',
      authorUserId: 'author',
      assigneeRole: 'staff',
    });
    expect(isPristineLogbookIssue(pristine)).toBe(true);
    expect(canRecallLogbookIssue(author, pristine, defs)).toBe(true);

    const started = entry({
      ...pristine,
      startedAt: '2026-07-21T09:00:00.000Z',
      startedByUserId: 's1',
      status: 'in_progress',
    });
    expect(canRecallLogbookIssue(author, started, defs)).toBe(false);
  });

  it('owner/am can recall active statuses; staff cannot', () => {
    const owner = profile({ userId: 'o1', role: 'owner' });
    const staff = profile({ userId: 's1', role: 'staff' });
    const waiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'staff',
      authorUserId: 'someone',
      resolutionSubmittedAt: '2026-07-21T10:00:00.000Z',
    });
    expect(canRecallLogbookIssue(owner, waiting, defs)).toBe(true);
    expect(canRecallLogbookIssue(staff, waiting, defs)).toBe(false);
  });

  it('hard delete owner + pristine only', () => {
    const owner = profile({ userId: 'o1', role: 'owner' });
    const manager = profile({ userId: 'm1', role: 'manager' });
    const pristine = entry({
      entryType: 'issue',
      status: 'open',
      assigneeRole: 'staff',
    });
    expect(canHardDeleteLogbookIssue(owner, pristine, defs)).toBe(true);
    expect(canHardDeleteLogbookIssue(manager, pristine, defs)).toBe(false);
    expect(
      canHardDeleteLogbookIssue(
        owner,
        entry({ ...pristine, startedAt: 'x', status: 'in_progress' }),
        defs,
      ),
    ).toBe(false);
  });

  it('blocks stale submit on recalled', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    const recalled = entry({
      entryType: 'issue',
      status: 'recalled',
      assigneeRole: 'staff',
    });
    expect(canSubmitResolutionNow(staff, recalled, defs)).toBe(false);
  });
});

describe('media separation', () => {
  it('treats legacy photo as source before submit, resolution after', () => {
    const before = entry({
      entryType: 'issue',
      photo: { id: 'f1', url: 'https://x/a.jpg' },
    });
    expect(resolveSourceMedia(before)).toEqual([{ id: 'f1', url: 'https://x/a.jpg' }]);
    expect(resolveResolutionMedia(before)).toEqual([]);

    const after = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      photo: { id: 'f1', url: 'https://x/a.jpg' },
    });
    expect(resolveSourceMedia(after)).toEqual([]);
    expect(resolveResolutionMedia(after).map((f) => f.id)).toEqual(['f1']);
  });

  it('prefers explicit sourceMedia / resolutionMedia links', () => {
    const e = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      photo: { id: 'legacy', url: 'https://x/l.jpg' },
      sourceMedia: [{ id: 's1', url: 'https://x/s.jpg' }],
      resolutionMedia: [{ id: 'r1', url: 'https://x/r.jpg' }],
    });
    expect(resolveSourceMedia(e)[0]?.id).toBe('s1');
    expect(resolveResolutionMedia(e).map((f) => f.id)).toEqual(['r1']);
  });

  it('normalizes legacy single-object resolutionMedia to an array', () => {
    const e = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      // Simulate cached Instant "one" shape during rollout
      resolutionMedia: { id: 'r1', url: 'https://x/r.jpg' } as unknown as LogbookEntry['resolutionMedia'],
    });
    expect(resolveResolutionMedia(e).map((f) => f.id)).toEqual(['r1']);
  });

  it('resolveResolutionMedia returns all current proofs', () => {
    const e = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionMedia: [
        { id: 'r1', url: 'https://x/r1.jpg' },
        { id: 'r2', url: 'https://x/r2.jpg' },
      ],
    });
    expect(resolveResolutionMedia(e).map((f) => f.id)).toEqual(['r1', 'r2']);
  });

  it('resolveResolutionProofs separates current vs history', () => {
    const a = { id: 'a', url: 'https://x/a.jpg' };
    const b = { id: 'b', url: 'https://x/b.jpg' };
    const c = { id: 'c', url: 'https://x/c.jpg' };

    const withHistory = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionProofHistory: [a, b, c],
      resolutionMedia: [b, c],
    });
    expect(resolveResolutionProofs(withHistory)).toEqual({
      current: [b, c],
      history: [a],
    });

    const currentOnly = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionMedia: [b, c],
    });
    expect(resolveResolutionProofs(currentOnly)).toEqual({
      current: [b, c],
      history: [],
    });

    const historyMissingCurrent = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionProofHistory: [a],
      resolutionMedia: [b],
    });
    expect(resolveResolutionProofs(historyMissingCurrent)).toEqual({
      current: [b],
      history: [a],
    });
  });
});

describe('resolution proof types', () => {
  it('defaults missing proof type to photo', () => {
    expect(resolveLogbookProofType(entry({}))).toBe('photo');
    expect(resolveLogbookProofType(entry({ resolutionProofType: 'photo_note' }))).toBe(
      'photo_note',
    );
  });

  it('emptyResolutionDraft starts with empty media array', () => {
    expect(emptyResolutionDraft()).toEqual({
      note: '',
      numberValue: '',
      checked: false,
      media: [],
    });
    expect(
      emptyResolutionDraft(
        entry({
          resolutionNote: 'prior',
          resolutionNumber: '3',
          resolutionChecked: true,
        }),
      ),
    ).toEqual({
      note: 'prior',
      numberValue: '3',
      checked: true,
      media: [],
    });
  });

  it('validates draft requirements per proof type', () => {
    expect(
      canSubmitResolutionDraft('tick', {
        note: '',
        numberValue: '',
        checked: true,
        media: [],
      }),
    ).toBe(true);
    expect(
      canSubmitResolutionDraft('tick', {
        note: '',
        numberValue: '',
        checked: false,
        media: [],
      }),
    ).toBe(false);
    expect(
      canSubmitResolutionDraft('note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: [],
      }),
    ).toBe(true);
    expect(
      canSubmitResolutionDraft('photo_note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: [],
      }),
    ).toBe(false);
    expect(
      canSubmitResolutionDraft('photo_note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: [
          {
            mediaRecordId: 'm1',
            fileId: 'f1',
            url: 'https://example.com/a.jpg',
            fileName: 'a.jpg',
            photoCode: 'x',
            capturedAt: '2026-07-21T12:00:00.000Z',
          },
        ],
      }),
    ).toBe(true);
    expect(
      canSubmitResolutionDraft('photo', {
        note: '',
        numberValue: '',
        checked: false,
        media: [
          {
            mediaRecordId: 'm1',
            fileId: 'f1',
            url: 'https://example.com/a.jpg',
            fileName: 'a.jpg',
            photoCode: 'x',
            capturedAt: '2026-07-21T12:00:00.000Z',
          },
          {
            mediaRecordId: 'm2',
            fileId: 'f2',
            url: 'https://example.com/b.jpg',
            fileName: 'b.jpg',
            photoCode: 'y',
            capturedAt: '2026-07-21T12:01:00.000Z',
          },
        ],
      }),
    ).toBe(true);
  });

  it('detects correction feedback on in_progress issues', () => {
    expect(
      hasCorrectionFeedback(
        entry({ entryType: 'issue', status: 'in_progress', reviewNote: 'Retake photo' }),
      ),
    ).toBe(true);
    expect(
      hasCorrectionFeedback(entry({ entryType: 'issue', status: 'in_progress', reviewNote: '' })),
    ).toBe(false);
  });

  it('idempotent attempt detection', () => {
    expect(
      isSameResolutionAttempt(
        entry({
          status: 'waiting_approval',
          resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
          resolutionAttemptId: 'att-1',
        }),
        'att-1',
      ),
    ).toBe(true);
    expect(
      isSameResolutionAttempt(
        entry({
          status: 'waiting_approval',
          resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
          resolutionAttemptId: 'att-1',
        }),
        'att-2',
      ),
    ).toBe(false);
  });

  it('my-assigned style matching includes waiting_approval', () => {
    const staff = profile({ userId: 's1', role: 'staff' });
    const waiting = entry({
      entryType: 'issue',
      status: 'waiting_approval',
      assigneeRole: 'staff',
      storeId: 'store-a',
    });
    expect(canViewLogbookEntry(staff, waiting, defs)).toBe(true);
    expect(canActOnAssignedIssue(staff, waiting, defs)).toBe(true);
  });
});

describe('assignee user multi-select', () => {
  const staffA = profile({ userId: 's1', role: 'staff', displayName: 'Ada' });
  const staffB = profile({ userId: 's2', role: 'staff', displayName: 'Bob' });
  const staffOtherStore = profile({
    userId: 's3',
    role: 'staff',
    displayName: 'Cara',
    stores: [{ ...storeA, id: 'store-b', code: 'STB', name: 'Store B' }],
  });
  const manager = profile({ userId: 'm1', role: 'manager', displayName: 'Mgr' });

  it('parse/serialize assignee user ids round-trip and treat empty as role-wide', () => {
    expect(parseAssigneeUserIds(undefined)).toEqual([]);
    expect(parseAssigneeUserIds('[]')).toEqual([]);
    expect(parseAssigneeUserIds('not-json')).toEqual([]);
    expect(serializeAssigneeUserIds(['s2', 's1', 's1', ''])).toBe('["s2","s1"]');
    expect(parseAssigneeUserIds(serializeAssigneeUserIds(['s1', 's2']))).toEqual(['s1', 's2']);
  });

  it('role-wide match when assigneeUserIdsJson empty; narrows when set', () => {
    const roleWide = entry({
      entryType: 'issue',
      assigneeRole: 'staff',
      storeId: 'store-a',
      assigneeUserIdsJson: '[]',
    });
    expect(profileMatchesAssignee(staffA, roleWide, defs)).toBe(true);
    expect(profileMatchesAssignee(staffB, roleWide, defs)).toBe(true);
    expect(profileMatchesAssignee(staffOtherStore, roleWide, defs)).toBe(false);
    expect(profileMatchesAssignee(manager, roleWide, defs)).toBe(false);

    const oneUser = entry({
      ...roleWide,
      assigneeUserIdsJson: serializeAssigneeUserIds(['s1']),
    });
    expect(profileMatchesAssignee(staffA, oneUser, defs)).toBe(true);
    expect(profileMatchesAssignee(staffB, oneUser, defs)).toBe(false);
    expect(canActOnAssignedIssue(staffA, { ...oneUser, status: 'open' }, defs)).toBe(true);
    expect(canActOnAssignedIssue(staffB, { ...oneUser, status: 'open' }, defs)).toBe(false);

    const multi = entry({
      ...roleWide,
      assigneeUserIdsJson: serializeAssigneeUserIds(['s1', 's2']),
    });
    expect(profileMatchesAssignee(staffA, multi, defs)).toBe(true);
    expect(profileMatchesAssignee(staffB, multi, defs)).toBe(true);
  });

  it('getLogbookAssigneeRecipients respects multi-user set', () => {
    const profiles = [staffA, staffB, staffOtherStore, manager];
    const roleWide = entry({
      entryType: 'issue',
      assigneeRole: 'staff',
      storeId: 'store-a',
      assigneeUserIdsJson: '[]',
    });
    expect(getLogbookAssigneeRecipients(roleWide, profiles, undefined, defs).sort()).toEqual([
      's1',
      's2',
    ]);

    const oneUser = {
      ...roleWide,
      assigneeUserIdsJson: serializeAssigneeUserIds(['s2']),
    };
    expect(getLogbookAssigneeRecipients(oneUser, profiles, undefined, defs)).toEqual(['s2']);

    const multi = {
      ...roleWide,
      assigneeUserIdsJson: serializeAssigneeUserIds(['s1', 's2', 's3']),
    };
    // s3 has role but wrong store — excluded
    expect(getLogbookAssigneeRecipients(multi, profiles, undefined, defs).sort()).toEqual([
      's1',
      's2',
    ]);
  });

  it('eligibleAssigneeUsers lists approved role+store people sorted by name', () => {
    const pending = profile({
      userId: 's9',
      role: 'staff',
      displayName: 'Zed',
      approvalStatus: 'pending',
    });
    const list = eligibleAssigneeUsers('store-a', 'staff', [staffB, staffA, pending, manager], defs);
    expect(list.map((p) => p.userId)).toEqual(['s1', 's2']);
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
    entry({
      id: '4',
      entryType: 'issue',
      status: 'recalled',
      dueAt: '2026-07-20T10:00:00.000Z',
      date: '2026-07-20',
    }),
  ];

  it('filters to issues only, excludes recalled by default, and counts statuses', () => {
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

describe('notes & announcements home helpers', () => {
  const staff = profile({ userId: 'staff-1', role: 'staff' });
  const hybrid = profile({ userId: 'hybrid-1', role: 'hybrid' });
  const manager = profile({ userId: 'mgr-1', role: 'manager' });
  const subleader = profile({ userId: 'sub-1', role: 'subleader' });
  const staffOtherStore = profile({
    userId: 'staff-other',
    role: 'staff',
    stores: [{ ...storeA, id: 'store-b', code: 'STB', name: 'Store B' }],
  });
  const author = profile({ userId: 'author-1', role: 'manager' });

  it('isStaffOrHybrid only for staff and hybrid', () => {
    expect(isStaffOrHybrid('staff')).toBe(true);
    expect(isStaffOrHybrid('hybrid')).toBe(true);
    expect(isStaffOrHybrid('subleader')).toBe(false);
    expect(isStaffOrHybrid('manager')).toBe(false);
  });

  it('lists requiresAck notes/announcements pending-first then by createdAt desc', () => {
    const entries = [
      entry({
        id: 'acked-old',
        entryType: 'note',
        requiresAck: true,
        ackUserIdsJson: JSON.stringify([staff.userId]),
        createdAt: '2026-07-20T10:00:00.000Z',
      }),
      entry({
        id: 'pending-new',
        entryType: 'announcement',
        requiresAck: true,
        ackUserIdsJson: '[]',
        createdAt: '2026-07-22T10:00:00.000Z',
      }),
      entry({
        id: 'pending-old',
        entryType: 'note',
        requiresAck: true,
        ackUserIdsJson: '[]',
        createdAt: '2026-07-21T10:00:00.000Z',
      }),
      entry({
        id: 'no-ack',
        entryType: 'note',
        requiresAck: false,
        createdAt: '2026-07-23T10:00:00.000Z',
      }),
      entry({
        id: 'issue',
        entryType: 'issue',
        requiresAck: true,
        assigneeRole: 'staff',
        createdAt: '2026-07-23T11:00:00.000Z',
      }),
    ];

    const listed = listNotesAnnouncementsForHome(staff, entries, defs);
    expect(listed.map((e) => e.id)).toEqual(['pending-new', 'pending-old', 'acked-old']);

    const { pending, acknowledgedByMe } = splitNotesAnnouncementsForHome(staff, entries, defs);
    expect(pending.map((e) => e.id)).toEqual(['pending-new', 'pending-old']);
    expect(acknowledgedByMe.map((e) => e.id)).toEqual(['acked-old']);
  });

  it('acknowledge JSON helper appends user id once', () => {
    expect(parseLogbookAckUserIds('[]')).toEqual([]);
    expect(hasMyLogbookAck(entry({ ackUserIdsJson: '[]' }), staff.userId)).toBe(false);
    const current = parseLogbookAckUserIds('[]');
    expect(current.includes(staff.userId)).toBe(false);
    const updated = JSON.stringify([...current, staff.userId]);
    expect(parseLogbookAckUserIds(updated)).toEqual([staff.userId]);
    expect(hasMyLogbookAck(entry({ ackUserIdsJson: updated }), staff.userId)).toBe(true);
  });

  it('resolveLogbookAckPeople preserves order, skips unknown, falls back labels', () => {
    const alex = profile({
      userId: 'u-alex',
      role: 'staff',
      displayName: '  Alex Nguyen  ',
      email: 'alex@test.com',
    });
    const mai = profile({
      userId: 'u-mai',
      role: 'hybrid',
      displayName: '   ',
      email: 'mai.tran@test.com',
    });
    const noEmail = profile({
      userId: 'u-bare',
      role: 'manager',
      displayName: '',
      email: '',
    });

    expect(
      resolveLogbookAckPeople(entry({ ackUserIdsJson: '[]' }), [alex, mai]),
    ).toEqual([]);

    const people = resolveLogbookAckPeople(
      entry({
        ackUserIdsJson: JSON.stringify(['u-mai', 'missing', 'u-alex', 'u-bare']),
      }),
      [alex, mai, noEmail],
    );
    expect(people).toEqual([
      {
        userId: 'u-mai',
        displayName: 'mai.tran',
        role: 'hybrid',
        storeCodesLabel: 'TKC',
        allStores: false,
      },
      {
        userId: 'u-alex',
        displayName: 'Alex Nguyen',
        role: 'staff',
        storeCodesLabel: 'TKC',
        allStores: false,
      },
      {
        userId: 'u-bare',
        displayName: 'u-bare',
        role: 'manager',
        storeCodesLabel: 'TKC',
        allStores: false,
      },
    ]);
  });

  it('resolveLogbookAckPeople joins store codes and flags allStores', () => {
    const withStores = profile({
      userId: 'u-multi',
      role: 'staff',
      displayName: 'Multi',
      stores: [
        { ...storeA, id: 's1', code: 'OHCM', name: 'HCM' },
        { ...storeA, id: 's2', code: '', name: 'Saigon' },
        { ...storeA, id: 's3', code: 'SGN', name: 'SGN Store' },
      ],
    });
    const ownerNoStores = profile({
      userId: 'u-owner',
      role: 'owner',
      displayName: 'Ops',
      stores: [],
    });
    const staffNoStores = profile({
      userId: 'u-staff-empty',
      role: 'staff',
      displayName: 'Lonely',
      stores: [],
    });
    const ownerWithStores = profile({
      userId: 'u-owner-stores',
      role: 'owner',
      displayName: 'Owner Local',
      stores: [{ ...storeA, code: 'OHCM', name: 'HCM' }],
    });

    const people = resolveLogbookAckPeople(
      entry({
        ackUserIdsJson: JSON.stringify([
          'u-multi',
          'u-owner',
          'u-staff-empty',
          'u-owner-stores',
        ]),
      }),
      [withStores, ownerNoStores, staffNoStores, ownerWithStores],
      defs,
    );
    expect(people).toEqual([
      {
        userId: 'u-multi',
        displayName: 'Multi',
        role: 'staff',
        storeCodesLabel: 'OHCM, Saigon, SGN',
        allStores: false,
      },
      {
        userId: 'u-owner',
        displayName: 'Ops',
        role: 'owner',
        storeCodesLabel: '',
        allStores: true,
      },
      {
        userId: 'u-staff-empty',
        displayName: 'Lonely',
        role: 'staff',
        storeCodesLabel: '',
        allStores: false,
      },
      {
        userId: 'u-owner-stores',
        displayName: 'Owner Local',
        role: 'owner',
        storeCodesLabel: 'OHCM',
        allStores: false,
      },
    ]);
  });

  it('getNoteAnnouncementRecipients includes all viewing roles, store-scoped, excludes actor', () => {
    const note = entry({
      id: 'n1',
      entryType: 'note',
      storeId: 'store-a',
      requiresAck: true,
      authorUserId: author.userId,
    });
    const profiles = [staff, hybrid, manager, subleader, staffOtherStore, author];

    expect(getNoteAnnouncementRecipients(note, profiles, author.userId, defs).sort()).toEqual([
      'hybrid-1',
      'mgr-1',
      'staff-1',
      'sub-1',
    ]);

    // Actor excluded even if staff
    expect(
      getNoteAnnouncementRecipients(note, profiles, staff.userId, defs).sort(),
    ).toEqual(['author-1', 'hybrid-1', 'mgr-1', 'sub-1']);

    // Blank store = all stores audience → viewing roles across stores included
    const allStoresNote = entry({
      id: 'n2',
      entryType: 'announcement',
      storeId: '',
      requiresAck: true,
      authorUserId: author.userId,
    });
    expect(
      getNoteAnnouncementRecipients(allStoresNote, profiles, author.userId, defs).sort(),
    ).toEqual(['hybrid-1', 'mgr-1', 'staff-1', 'staff-other', 'sub-1']);
  });

  it('buildLogbookNoteAnnouncementNotifications skips when no requiresAck or no recipients', () => {
    const noAck = entry({
      entryType: 'note',
      requiresAck: false,
      authorUserId: author.userId,
    });
    expect(
      buildLogbookNoteAnnouncementNotifications(noAck, author, [staff, hybrid], defs),
    ).toEqual([]);

    const note = entry({
      entryType: 'note',
      requiresAck: true,
      storeId: 'store-b',
      authorUserId: author.userId,
    });
    // viewing roles only have store-a → no recipients
    expect(
      buildLogbookNoteAnnouncementNotifications(note, author, [staff, hybrid, manager], defs),
    ).toEqual([]);
  });

  it('buildLogbookNoteAnnouncementNotifications creates txs for viewing-role recipients', () => {
    const note = entry({
      id: 'note-tx',
      entryType: 'announcement',
      requiresAck: true,
      storeId: 'store-a',
      authorUserId: author.userId,
      content: 'All hands meeting',
      severity: 'warning',
    });
    const txs = buildLogbookNoteAnnouncementNotifications(
      note,
      author,
      [staff, hybrid, manager, subleader],
      defs,
    );
    expect(txs).toHaveLength(4);
  });
});
