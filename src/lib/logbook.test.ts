import { describe, expect, it } from 'vitest';
import {
  canActOnAssignedIssue,
  canHardDeleteLogbookIssue,
  canOpenLogbook,
  canRecallLogbookIssue,
  canReviewLogbookIssue,
  canSubmitResolutionNow,
  canViewLogbookEntry,
  eligibleLogbookAssigneeRoles,
  getIssueConfigurationState,
  isIssueDueSoon,
  isIssueOverdue,
  isLogbookIssue,
  isPristineLogbookIssue,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
  resolveResolutionMedia,
  resolveResolutionProofs,
  resolveSourceMedia,
} from './logbook';
import {
  computeLogbookIssueMetrics,
  countLogbookIssues,
  filterLogbookIssues,
} from './logbookMetrics';
import {
  canSubmitResolutionDraft,
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
    expect(eligibleLogbookAssigneeRoles('hybrid', defs)).toEqual(['staff']);
    expect(eligibleLogbookAssigneeRoles('staff', defs)).toEqual([]);
    expect(eligibleLogbookAssigneeRoles('viewer', defs)).toEqual([]);
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
    expect(resolveResolutionMedia(before)).toBeNull();

    const after = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      photo: { id: 'f1', url: 'https://x/a.jpg' },
    });
    expect(resolveSourceMedia(after)).toEqual([]);
    expect(resolveResolutionMedia(after)?.id).toBe('f1');
  });

  it('prefers explicit sourceMedia / resolutionMedia links', () => {
    const e = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      photo: { id: 'legacy', url: 'https://x/l.jpg' },
      sourceMedia: [{ id: 's1', url: 'https://x/s.jpg' }],
      resolutionMedia: { id: 'r1', url: 'https://x/r.jpg' },
    });
    expect(resolveSourceMedia(e)[0]?.id).toBe('s1');
    expect(resolveResolutionMedia(e)?.id).toBe('r1');
  });

  it('resolveResolutionProofs merges history and current without dupes', () => {
    const a = { id: 'a', url: 'https://x/a.jpg' };
    const b = { id: 'b', url: 'https://x/b.jpg' };
    const withHistory = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionProofHistory: [a, b],
      resolutionMedia: b,
    });
    expect(resolveResolutionProofs(withHistory).map((f) => f.id)).toEqual(['a', 'b']);

    const currentOnly = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionMedia: b,
    });
    expect(resolveResolutionProofs(currentOnly).map((f) => f.id)).toEqual(['b']);

    const historyMissingCurrent = entry({
      entryType: 'issue',
      resolutionSubmittedAt: '2026-07-21T12:00:00.000Z',
      resolutionProofHistory: [a],
      resolutionMedia: b,
    });
    expect(resolveResolutionProofs(historyMissingCurrent).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('resolution proof types', () => {
  it('defaults missing proof type to photo', () => {
    expect(resolveLogbookProofType(entry({}))).toBe('photo');
    expect(resolveLogbookProofType(entry({ resolutionProofType: 'photo_note' }))).toBe(
      'photo_note',
    );
  });

  it('validates draft requirements per proof type', () => {
    expect(
      canSubmitResolutionDraft('tick', {
        note: '',
        numberValue: '',
        checked: true,
        media: null,
      }),
    ).toBe(true);
    expect(
      canSubmitResolutionDraft('tick', {
        note: '',
        numberValue: '',
        checked: false,
        media: null,
      }),
    ).toBe(false);
    expect(
      canSubmitResolutionDraft('note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: null,
      }),
    ).toBe(true);
    expect(
      canSubmitResolutionDraft('photo_note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: null,
      }),
    ).toBe(false);
    expect(
      canSubmitResolutionDraft('photo_note', {
        note: 'done',
        numberValue: '',
        checked: false,
        media: {
          mediaRecordId: 'm1',
          fileId: 'f1',
          url: 'https://example.com/a.jpg',
          fileName: 'a.jpg',
          photoCode: 'x',
          capturedAt: '2026-07-21T12:00:00.000Z',
        },
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
