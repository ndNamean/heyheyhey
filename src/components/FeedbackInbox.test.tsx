/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const {
  loadNextPage,
  transact,
  markAllApi,
  reconcileApi,
  infiniteState,
} = vi.hoisted(() => {
  const infiniteState = {
    data: { notifications: [] as Array<Record<string, unknown>> },
    isLoading: false,
    canLoadNextPage: false,
    error: null as Error | null,
  };
  return {
    loadNextPage: vi.fn(),
    transact: vi.fn(async () => undefined),
    markAllApi: vi.fn(async () => 2),
    reconcileApi: vi.fn(async () => 0),
    infiniteState,
  };
});

vi.mock('../db', () => ({
  db: {
    useInfiniteQuery: () => ({
      data: infiniteState.data,
      isLoading: infiniteState.isLoading,
      canLoadNextPage: infiniteState.canLoadNextPage,
      loadNextPage,
      error: infiniteState.error,
    }),
    useQuery: () => ({ data: {}, isLoading: false }),
    transact,
    tx: {
      notifications: new Proxy(
        {},
        {
          get: (_t, id: string) => ({
            update: (attrs: Record<string, unknown>) => ({
              __ops: [['update', 'notifications', id, attrs]],
            }),
          }),
        },
      ),
      notificationUnreadCounts: new Proxy(
        {},
        {
          get: (_t, id: string) => ({
            update: (attrs: Record<string, unknown>) => ({
              __ops: [['update', 'notificationUnreadCounts', id, attrs]],
            }),
          }),
        },
      ),
    },
    queryOnce: vi.fn(async () => ({
      data: {
        notificationUnreadCounts: [{ id: 'c1', userId: 'u1', unreadCount: 2 }],
      },
    })),
    getAuth: vi.fn(async () => ({ refresh_token: 'tok' })),
  },
}));

vi.mock('../hooks/useNotificationUnreadCount', () => ({
  useNotificationUnreadCount: () => ({
    unreadCount: 2,
    row: { id: 'c1', userId: 'u1', unreadCount: 2, updatedAt: '' },
    isLoading: false,
  }),
  useUnreadNotificationCount: () => 2,
}));

vi.mock('../lib/notificationUnreadCount', async () => {
  const actual = await vi.importActual<typeof import('../lib/notificationUnreadCount')>(
    '../lib/notificationUnreadCount',
  );
  return {
    ...actual,
    markAllNotificationsReadViaApi: ((...args: unknown[]) => markAllApi(...(args as []))) as typeof markAllApi,
    reconcileOwnUnreadCount: ((...args: unknown[]) => reconcileApi(...(args as []))) as typeof reconcileApi,
  };
});

vi.mock('../i18n', () => ({
  useLang: () => ({
    t: {
      staffHome: { feedback: 'Inbox' },
      common: { new: 'new', selectAll: 'Select all', clearAll: 'Clear', selectedCount: '{count} selected' },
      feedback: {
        completion: 'Completion',
        compliance: 'Compliance',
        reviewedBy: 'Reviewed by',
        reportSummary: 'report summary',
        markSelectedRead: 'Mark selected',
        markAllRead: 'Mark all',
        confirmMarkAllRead: 'Mark all {count}?',
        loadMore: 'Load more',
        showingOf: 'Showing {shown}',
        showAll: 'Show all',
        unreadOnly: 'Unread only',
        loading: 'Loading…',
        emptyUnread: "You're all caught up",
        emptyAll: 'No notifications yet',
        loadMoreError: 'Could not load more',
        retry: 'Retry',
      },
      timeline: { expand: 'Show timeline', collapse: 'Hide timeline' },
      logbook: { openInLogbook: 'Open in Logbook' },
    },
  }),
}));

vi.mock('../lib/i18nUtils', () => ({
  statusLabel: (_t: unknown, s: string) => s || 'status',
}));

vi.mock('./ReportTimeline', () => ({ default: () => null }));
vi.mock('./profileAvatar/IdentityWithAvatar', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('./LinkifiedText', () => ({
  LinkifiedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

import FeedbackInbox from './FeedbackInbox';

function notif(partial: Record<string, unknown>) {
  return {
    id: 'n1',
    recipientUserId: 'u1',
    type: 'item_approved',
    reportId: '',
    reportResponseId: '',
    storeId: '',
    title: 'Hello',
    body: 'Body',
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: 'approved',
    actorUserId: '',
    actorRole: '',
    readAt: '',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...partial,
  };
}

describe('FeedbackInbox infinite modes', () => {
  beforeEach(() => {
    cleanup();
    loadNextPage.mockReset();
    transact.mockClear();
    markAllApi.mockClear();
    infiniteState.isLoading = false;
    infiniteState.canLoadNextPage = false;
    infiniteState.error = null;
    infiniteState.data = {
      notifications: [notif({ id: 'n1', title: 'Unread one' })],
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to unread list and toggles to Show all', () => {
    render(
      <FeedbackInbox
        userId="u1"
        reports={[]}
        events={[]}
        profileRecords={[]}
      />,
    );
    expect(screen.getByText('Unread one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByRole('button', { name: 'Unread only' })).toBeTruthy();
  });

  it('shows Load more when canLoadNextPage and calls loadNextPage', async () => {
    infiniteState.canLoadNextPage = true;
    render(
      <FeedbackInbox
        userId="u1"
        reports={[]}
        events={[]}
        profileRecords={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(loadNextPage).toHaveBeenCalled());
  });

  it('mark all uses Admin API (not client full scan)', async () => {
    render(
      <FeedbackInbox
        userId="u1"
        reports={[]}
        events={[]}
        profileRecords={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark all' }));
    await waitFor(() => expect(markAllApi).toHaveBeenCalled());
  });

  it('shows empty unread copy when list is empty', () => {
    infiniteState.data = { notifications: [] };
    render(
      <FeedbackInbox
        userId="u1"
        reports={[]}
        events={[]}
        profileRecords={[]}
      />,
    );
    expect(screen.getByText(/all caught up/i)).toBeTruthy();
  });
});
