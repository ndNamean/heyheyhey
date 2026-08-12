// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDefinitionsAsEntities } from '../lib/roleResolver';
import type { LogbookEntry, Profile, Store } from '../types';
import LogbookNotificationPreviewModal, {
  decideLogbookNotificationClick,
} from './LogbookNotificationPreviewModal';

vi.mock('../i18n', () => ({
  useLang: () => ({
    lang: 'en',
    t: {
      common: { close: 'Close', store: 'Store', allStores: 'All stores' },
      status: {
        open: 'Open',
        resolved: 'Resolved',
        recalled: 'Recalled',
        waiting_approval: 'Waiting approval',
        in_progress: 'In progress',
      },
      logbook: {
        previewTitle: 'Logbook entry',
        previewEntryId: 'Entry ID',
        previewCreatedBy: 'Created by',
        previewCreated: 'Created',
        previewDue: 'Due',
        previewStatus: 'Status',
        previewAssignee: 'Assignee',
        previewAlreadyResolved: 'Already resolved by {name}',
        previewAlreadyRecalled: 'Already recalled by {name}',
        previewOpenFull: 'Open full entry in Logbook',
        previewMissingEntry: 'Entry details are unavailable.',
        previewUnknownActor: 'Someone',
        assigneeNotSubmitted: 'Not submitted',
        assigneeSubmitted: 'Submitted',
        assigneeWaitingApproval: 'Waiting approval',
        assigneeCorrection: 'Correction requested',
        assigneeApproved: 'Approved',
        assigneeRosterSummary: 'Submitted {done}/{total}',
        statusOverdue: 'Overdue',
        overdueRemindAssignedTo: 'This logbook is assigned to {mentions}',
        overdueRemindUnassigned:
          'This overdue issue has no assignees. Complete assignment before reminding to Store Chat.',
        overdueRemindAsk: 'Remind overdue to Store Chat?',
        overdueRemindConfirm: 'Remind to Store Chat',
        overdueRemindNotNow: 'Not now',
        overdueRemindAlready: 'This overdue was already reminded to Store Chat once',
        overdueRemindOpenChat: 'Open Store Chat',
        overdueRemindBusy: 'Sending…',
        overdueRemindSuccess: 'Overdue reminded to Store Chat.',
        overdueRemindSkipNoLonger: 'Issue is no longer overdue — no chat sent.',
        overdueRemindSkipAlready: 'Already reminded once — no second chat sent.',
        overdueRemindSkipUnassigned: 'Missing assignment — no chat sent.',
        overdueRemindFailed: 'Could not send overdue remind.',
      },
    },
  }),
}));

vi.mock('../lib/nativeBack', () => ({
  BACK_PRIORITY: { MODAL: 50 },
  useNativeBack: () => undefined,
}));

vi.mock('../db', () => ({
  db: {
    queryOnce: vi.fn(async () => ({ data: { storeChatMessages: [] } })),
  },
}));

const { remindMock } = vi.hoisted(() => ({ remindMock: vi.fn() }));
vi.mock('../lib/logbookNotifyClient', () => ({
  remindOverdueToStoreChat: (...args: unknown[]) => remindMock(...args),
}));

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
    id: partial.id ?? 'abcdef123456',
    storeId: partial.storeId ?? 'store-a',
    authorUserId: partial.authorUserId ?? 'author',
    date: '2026-08-10',
    shift: 'AM',
    content: partial.content ?? 'Fridge leak',
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
    store: storeA,
    ...partial,
  };
}

const owner = profile({ userId: 'owner-1', role: 'owner', displayName: 'Olivia Owner' });
const staff = profile({ userId: 'staff-1', role: 'staff', displayName: 'Sam Staff' });
const reviewer = profile({ userId: 'mgr-1', role: 'manager', displayName: 'Morgan Manager' });

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
  remindMock.mockReset();
});

describe('decideLogbookNotificationClick', () => {
  it('navigates for assignees (resolution auto-open path)', () => {
    expect(
      decideLogbookNotificationClick(
        'logbook_issue_overdue',
        staff,
        entry({ status: 'open', dueAt: '2026-08-01T00:00:00.000Z' }),
        defs,
      ),
    ).toBe('navigate');
  });

  it('previews for non-assignees', () => {
    expect(
      decideLogbookNotificationClick(
        'logbook_issue_overdue',
        owner,
        entry({ status: 'open', dueAt: '2026-08-01T00:00:00.000Z' }),
        defs,
      ),
    ).toBe('preview');
  });

  it('navigates when entry is missing', () => {
    expect(decideLogbookNotificationClick('logbook_issue_overdue', owner, null, defs)).toBe(
      'navigate',
    );
  });
});

describe('LogbookNotificationPreviewModal', () => {
  it('shows already resolved by reviewer/submitter', () => {
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          status: 'resolved',
          reviewedByUserId: 'mgr-1',
          resolvedByUserId: 'staff-1',
          dueAt: '2099-01-01T00:00:00.000Z',
        })}
        profile={owner}
        profiles={[owner, staff, reviewer]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('logbook-notif-preview-resolved').textContent).toContain(
      'Already resolved by',
    );
    expect(screen.getByTestId('logbook-notif-preview-resolved').textContent).toContain(
      'Morgan Manager',
    );
    expect(screen.queryByTestId('overdue-remind-panel')).toBeNull();
  });

  it('shows remind CTA for overdue when viewer can remind', () => {
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          status: 'open',
          dueAt: '2026-08-01T00:00:00.000Z',
          assigneeRole: 'staff',
        })}
        profile={owner}
        profiles={[owner, staff]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overdue-remind-panel')).toBeTruthy();
    expect(screen.getByTestId('overdue-remind-confirm')).toBeTruthy();
  });

  it('shows already-reminded branch', () => {
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          status: 'open',
          dueAt: '2026-08-01T00:00:00.000Z',
          overdueChatRemindedAt: '2026-08-10T11:00:00.000Z',
        })}
        profile={owner}
        profiles={[owner, staff]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overdue-remind-already').textContent).toContain(
      'already reminded',
    );
  });

  it('confirms remind via remindOverdueToStoreChat', async () => {
    remindMock.mockResolvedValue({ ok: true, chatCreated: 1 });
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          id: 'entry-remind',
          status: 'open',
          dueAt: '2026-08-01T00:00:00.000Z',
        })}
        profile={owner}
        profiles={[owner, staff]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('overdue-remind-confirm'));
    await waitFor(() => {
      expect(remindMock).toHaveBeenCalledWith({ entryId: 'entry-remind' });
    });
    expect(screen.getByTestId('logbook-notif-preview-remind-msg').textContent).toContain(
      'Overdue reminded',
    );
  });

  it('shows created-by and assignee identities with avatars', () => {
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          authorUserId: 'owner-1',
          assigneeRole: 'staff',
          assigneeUserIdsJson: '["staff-1"]',
        })}
        profile={owner}
        profiles={[owner, staff]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('logbook-notif-preview-id').textContent).toContain('#abcdef');
    expect(screen.getByTestId('logbook-notif-preview-created-by').textContent).toContain(
      'Olivia Owner',
    );
    expect(screen.getByTestId('logbook-notif-preview-assignee').textContent).toContain(
      'Sam Staff',
    );
    expect(screen.getByTestId('logbook-notif-preview-assignee').textContent).toContain(
      'Not submitted',
    );
    expect(document.querySelectorAll('.identity-with-avatar').length).toBeGreaterThanOrEqual(2);
  });

  it('shows waiting approval for submitter and not submitted for other assignees', () => {
    const staff2 = profile({ userId: 'staff-2', role: 'staff', displayName: 'Pat Staff' });
    render(
      <LogbookNotificationPreviewModal
        open
        entry={entry({
          authorUserId: 'owner-1',
          assigneeRole: 'staff',
          assigneeUserIdsJson: '["staff-1","staff-2"]',
          status: 'waiting_approval',
          resolutionSubmittedByUserId: 'staff-1',
        })}
        profile={owner}
        profiles={[owner, staff, staff2]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={vi.fn()}
      />,
    );
    const assignee = screen.getByTestId('logbook-notif-preview-assignee');
    expect(assignee.textContent).toContain('staff');
    expect(assignee.textContent).toContain('Submitted 1/2');
    expect(screen.getByTestId('logbook-assignee-roster-state-staff-1').textContent).toBe(
      'Waiting approval',
    );
    expect(screen.getByTestId('logbook-assignee-roster-state-staff-2').textContent).toBe(
      'Not submitted',
    );
  });

  it('open full entry callback fires', () => {
    const onOpenFullEntry = vi.fn();
    const e = entry({ id: 'entry-full' });
    render(
      <LogbookNotificationPreviewModal
        open
        entry={e}
        profile={owner}
        profiles={[owner]}
        defs={defs}
        onClose={vi.fn()}
        onOpenFullEntry={onOpenFullEntry}
      />,
    );
    fireEvent.click(screen.getByTestId('logbook-notif-preview-open-full'));
    expect(onOpenFullEntry).toHaveBeenCalledWith(e);
  });
});
