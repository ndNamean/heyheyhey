/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { loadNextPage, infiniteState, reconcileApi } = vi.hoisted(() => {
  const infiniteState = {
    data: { reports: [] as Array<Record<string, unknown>> },
    isLoading: false,
    canLoadNextPage: false,
    error: null as Error | null,
  };
  return {
    loadNextPage: vi.fn(),
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
    useQuery: () => ({ data: { reviewEvents: [] }, isLoading: false }),
  },
}));

vi.mock('../hooks/useReportNeedsActionCount', () => ({
  useReportNeedsActionCount: () => ({
    needsActionCount: 2,
    row: { id: 'c1', userId: 'u1', needsActionCount: 2, updatedAt: '' },
    isLoading: false,
  }),
}));

vi.mock('../lib/reportNeedsAction', async () => {
  const actual = await vi.importActual<typeof import('../lib/reportNeedsAction')>(
    '../lib/reportNeedsAction',
  );
  return {
    ...actual,
    reconcileOwnReportNeedsActionCount: ((...args: unknown[]) =>
      reconcileApi(...(args as []))) as typeof reconcileApi,
  };
});

vi.mock('../i18n', () => ({
  useLang: () => ({
    t: {
      staffHome: {
        myReports: 'My reports',
        needAction: 'need action',
        needsActionOnly: 'Needs action',
        showAll: 'Show all',
        myReportsModeLabel: 'My reports mode',
        myReportsLoading: 'Loading…',
        myReportsEmptyNeedsAction: "You're all caught up",
        myReportsEmptyAll: 'No reports yet',
        myReportsLoadError: 'Could not load reports',
        myReportsLoadMoreError: 'Could not load more',
        myReportsLoadMore: 'Load more',
        myReportsRetry: 'Retry',
        myReportsShowing: 'Showing {shown}',
        fixResubmit: 'Fix & resubmit',
        completeRemaining: 'Complete remaining',
        completeAndFix: 'Complete & fix',
        item: 'item',
        items: 'items',
      },
      feedback: { completion: 'Completion', compliance: 'Compliance' },
    },
  }),
}));

vi.mock('../lib/i18nUtils', () => ({
  statusLabel: (_t: unknown, s: string) => s || 'status',
}));

vi.mock('./ReportTimeline', () => ({ default: () => null }));

import MyReportsPanel from './MyReportsPanel';

function report(partial: Record<string, unknown>) {
  return {
    id: 'r1',
    storeId: 's1',
    storeCode: 'S1',
    storeName: 'Store',
    templateId: 't1',
    templateName: 'Opening',
    reportType: 'checklist',
    reportDate: '2026-01-01',
    submittedByUserId: 'u1',
    submittedByRole: 'staff',
    submittedAt: '2026-01-02T00:00:00.000Z',
    status: 'waiting_approval',
    submitterNeedsAction: true,
    completionPercent: 100,
    compliancePercent: 0,
    archived: false,
    archiveMonth: '',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    responses: [
      {
        id: 'resp1',
        status: 'need_correction',
        title: 'Fridge check',
        rejectionReason: 'Blurry',
      },
    ],
    ...partial,
  };
}

const profile = {
  id: 'p1',
  userId: 'u1',
  email: 'a@b.com',
  displayName: 'Alex',
  role: 'staff',
} as Parameters<typeof MyReportsPanel>[0]['profile'];

describe('MyReportsPanel infinite modes', () => {
  beforeEach(() => {
    cleanup();
    loadNextPage.mockReset();
    reconcileApi.mockClear();
    infiniteState.isLoading = false;
    infiniteState.canLoadNextPage = false;
    infiniteState.error = null;
    infiniteState.data = {
      reports: [report({ id: 'r1', templateName: 'Opening' })],
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to Needs action mode and can switch to Show all', () => {
    render(<MyReportsPanel profile={profile} />);
    expect(screen.getByText(/Opening/)).toBeTruthy();
    const needsAction = screen.getByRole('button', { name: 'Needs action' });
    const showAll = screen.getByRole('button', { name: 'Show all' });
    expect(needsAction.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(showAll);
    expect(showAll.getAttribute('aria-pressed')).toBe('true');
    expect(needsAction.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows exact badge count from counter hook', () => {
    render(<MyReportsPanel profile={profile} />);
    expect(screen.getByText(/2 need action/)).toBeTruthy();
  });

  it('shows Load more when canLoadNextPage and calls loadNextPage', async () => {
    infiniteState.canLoadNextPage = true;
    render(<MyReportsPanel profile={profile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(loadNextPage).toHaveBeenCalled());
  });

  it('shows caught-up empty state with a single header Show all', () => {
    infiniteState.data = { reports: [] };
    render(<MyReportsPanel profile={profile} />);
    expect(screen.getByText(/You're all caught up/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Show all' }).length).toBe(1);
  });

  it('preserves Fix & resubmit for flagged responses', () => {
    const onFixReport = vi.fn();
    render(<MyReportsPanel profile={profile} onFixReport={onFixReport} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix & resubmit/ }));
    expect(onFixReport).toHaveBeenCalledWith('r1');
  });

  it('shows Complete remaining for not_started-only store work', () => {
    infiniteState.data = {
      reports: [
        report({
          id: 'r2',
          responses: [
            {
              id: 'resp2',
              status: 'not_started',
              title: 'VG check',
              required: true,
              rejectionReason: '',
            },
          ],
        }),
      ],
    };
    const onFixReport = vi.fn();
    render(<MyReportsPanel profile={profile} onFixReport={onFixReport} />);
    fireEvent.click(screen.getByRole('button', { name: /Complete remaining/ }));
    expect(onFixReport).toHaveBeenCalledWith('r2');
  });
});
