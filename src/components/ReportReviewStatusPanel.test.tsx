/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Profile, Report, Store } from '../types';

const { loadNextPage, infiniteState, queryCalls, pendingCountState } = vi.hoisted(() => ({
  loadNextPage: vi.fn(),
  infiniteState: {
    data: null as { reports: Report[] } | null,
    isLoading: false,
    canLoadNextPage: false,
    error: null as Error | null,
  },
  queryCalls: [] as unknown[],
  pendingCountState: {
    data: null as { reports: Report[] } | null,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('../db', () => ({
  db: {
    useInfiniteQuery: (query: Record<string, unknown> | null) => {
      queryCalls.push({ type: 'infinite', query });
      return {
        data: infiniteState.data,
        isLoading: infiniteState.isLoading,
        canLoadNextPage: infiniteState.canLoadNextPage,
        loadNextPage,
        error: infiniteState.error,
      };
    },
    useQuery: (query: Record<string, unknown> | null) => {
      queryCalls.push({ type: 'query', query });
      if (!query) return { data: null, isLoading: false, error: null };
      if ('reports' in query) return pendingCountState;
      if ('reviewEvents' in query) return { data: { reviewEvents: [] }, isLoading: false, error: null };
      if ('profiles' in query) return { data: { profiles: [] }, isLoading: false, error: null };
      return { data: {}, isLoading: false, error: null };
    },
  },
}));

vi.mock('../contexts/RoleDefinitionsContext', () => ({
  useRoleDefinitions: () => ({ defs: [], isLoading: false }),
}));

vi.mock('../i18n', () => ({
  useLang: () => ({
    t: {
      reportReviewStatus: {
        title: 'Report Review Status',
        noReports: 'No reports in your stores for the last 30 days.',
        noPending: 'No pending reports',
        pendingOnly: 'Pending',
        showAll: 'Show all',
        modeLabel: 'Report review status mode',
        loadMore: 'Load more',
        loadMoreError: 'Could not load more',
        loadError: 'Could not load reports',
        retry: 'Retry',
        submittedBy: 'Submitted by',
        submittedTime: 'Submitted time',
        latestReview: 'Latest review',
        latestFeedback: 'Latest feedback',
        finalizedTime: 'Finalized time',
        correctionTime: 'Correction time',
        viewTimeline: 'View timeline',
        hideTimeline: 'Hide timeline',
        pending: 'pending',
        needCorrection: 'need correction',
        rejected: 'rejected',
        approved: 'approved',
      },
      export: {
        exportTable: 'Export Table',
        scopeCurrentList: 'Current list',
        scopeAllAssigned: 'All assigned',
      },
      common: {
        date: 'Date',
        store: 'Store',
        status: 'Status',
        loading: 'Loading…',
        error: 'Error',
        retry: 'Retry',
      },
      timeline: {
        leadTime: 'Lead time',
        pending: 'Pending',
        partialHistory: 'Partial history',
      },
    },
  }),
}));

vi.mock('../lib/i18nUtils', () => ({
  statusLabel: (_t: unknown, s: string) => s || 'status',
}));

vi.mock('./ExportModal', () => ({ default: () => null }));
vi.mock('./ReportTimeline', () => ({ default: () => null }));
vi.mock('./profileAvatar/IdentityWithAvatar', () => ({
  default: ({ children }: { children: unknown }) => children,
}));

import ReportReviewStatusPanel from './ReportReviewStatusPanel';

const storeA: Store = {
  id: 'store-a',
  code: 'XD',
  name: 'XD Store',
  address: '',
  area: '',
  lat: 0,
  lng: 0,
  geofenceRadiusM: 100,
  active: true,
  createdAt: '',
  updatedAt: '',
};

const manager = {
  id: 'p-m1',
  userId: 'm1',
  email: 'm1@test.com',
  displayName: 'Manager',
  role: 'manager',
  approvalStatus: 'approved',
  approvedAt: '',
  approvedByEmail: '',
  createdAt: '',
  updatedAt: '',
  stores: [storeA],
} as Profile;

function reportInWindow(partial: Partial<Report> = {}): Report {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: 'r1',
    storeId: 'store-a',
    storeCode: 'XD',
    storeName: 'XD Store',
    templateId: 't1',
    templateName: 'Opening',
    reportType: 'daily',
    reportDate: today,
    submittedByUserId: 'staff1',
    submittedByRole: 'staff',
    submittedAt: `${today}T01:00:00.000Z`,
    status: 'waiting_approval',
    completionPercent: 100,
    compliancePercent: 0,
    archived: false,
    archiveMonth: '',
    createdAt: '',
    updatedAt: '',
    responses: [],
    ...partial,
  };
}

function lastInfiniteReportsQuery(): {
  reports: {
    $?: { where?: Record<string, unknown>; limit?: number; order?: unknown };
    responses?: unknown;
  };
} | null {
  for (let i = queryCalls.length - 1; i >= 0; i--) {
    const call = queryCalls[i] as { type?: string; query?: unknown };
    if (call?.type !== 'infinite') continue;
    const q = call.query;
    if (q && typeof q === 'object' && 'reports' in q) {
      return q as {
        reports: {
          $?: { where?: Record<string, unknown>; limit?: number; order?: unknown };
          responses?: unknown;
        };
      };
    }
  }
  return null;
}

function lastPendingCountQuery(): {
  reports: { $?: { where?: Record<string, unknown>; limit?: number }; responses?: unknown };
} | null {
  for (let i = queryCalls.length - 1; i >= 0; i--) {
    const call = queryCalls[i] as { type?: string; query?: unknown };
    if (call?.type !== 'query') continue;
    const q = call.query;
    if (q && typeof q === 'object' && 'reports' in q) {
      return q as {
        reports: { $?: { where?: Record<string, unknown>; limit?: number }; responses?: unknown };
      };
    }
  }
  return null;
}

describe('ReportReviewStatusPanel query scoping', () => {
  beforeEach(() => {
    cleanup();
    queryCalls.length = 0;
    loadNextPage.mockReset();
    infiniteState.data = null;
    infiniteState.isLoading = false;
    infiniteState.canLoadNextPage = false;
    infiniteState.error = null;
    pendingCountState.data = null;
    pendingCountState.isLoading = false;
    pendingCountState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to Pending mode with waiting_approval where and page size 20', () => {
    infiniteState.data = { reports: [reportInWindow()] };
    pendingCountState.data = { reports: [reportInWindow(), reportInWindow({ id: 'r2' })] };
    render(<ReportReviewStatusPanel profile={manager} />);

    const listQuery = lastInfiniteReportsQuery();
    expect(listQuery?.reports.$?.where).toMatchObject({
      storeId: { $in: ['store-a'] },
      status: 'waiting_approval',
    });
    expect(listQuery?.reports.$?.where?.reportDate).toMatchObject({
      $gte: expect.any(String),
      $lte: expect.any(String),
    });
    expect(listQuery?.reports.$?.limit).toBe(20);
    expect(listQuery?.reports.$?.order).toEqual({ submittedAt: 'desc' });
    expect(listQuery?.reports.responses).toEqual({});

    const pending = screen.getByRole('button', { name: 'Pending' });
    const showAll = screen.getByRole('button', { name: 'Show all' });
    expect(pending.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('XD')).toBeTruthy();
  });

  it('shows exact pending badge from thin count query (not list page size)', () => {
    infiniteState.data = { reports: [reportInWindow()] };
    pendingCountState.data = {
      reports: Array.from({ length: 23 }, (_, i) => reportInWindow({ id: `p${i}` })),
    };
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText(/23 pending/)).toBeTruthy();

    const countQuery = lastPendingCountQuery();
    expect(countQuery?.reports.$?.where).toMatchObject({ status: 'waiting_approval' });
    expect(countQuery?.reports.$?.limit).toBe(1000);
    expect(countQuery?.reports.responses).toBeUndefined();
  });

  it('switches to Show all without status filter', () => {
    infiniteState.data = { reports: [reportInWindow({ status: 'approved' })] };
    pendingCountState.data = { reports: [] };
    render(<ReportReviewStatusPanel profile={manager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByRole('button', { name: 'Show all' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const listQuery = lastInfiniteReportsQuery();
    expect(listQuery?.reports.$?.where?.status).toBeUndefined();
    expect(listQuery?.reports.$?.where).toMatchObject({
      storeId: { $in: ['store-a'] },
    });
  });

  it('shows Load more when canLoadNextPage and calls loadNextPage', async () => {
    infiniteState.data = { reports: [reportInWindow()] };
    infiniteState.canLoadNextPage = true;
    pendingCountState.data = { reports: [reportInWindow()] };
    render(<ReportReviewStatusPanel profile={manager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(loadNextPage).toHaveBeenCalled());
  });

  it('does not subscribe meaningfully when the manager has no stores', () => {
    render(<ReportReviewStatusPanel profile={{ ...manager, stores: [] }} />);
    expect(screen.getByText('No pending reports')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Show all' }).length).toBe(1);
  });

  it('shows loading instead of the empty copy while the first fetch is in flight', () => {
    infiniteState.isLoading = true;
    infiniteState.data = null;
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No pending reports')).toBeNull();
  });

  it('treats a missing first result as loading, not empty', () => {
    infiniteState.isLoading = false;
    infiniteState.data = null;
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No pending reports')).toBeNull();
  });

  it('keeps last-good rows when a later query errors empty', () => {
    infiniteState.data = { reports: [reportInWindow()] };
    pendingCountState.data = { reports: [reportInWindow()] };
    const { rerender } = render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('XD')).toBeTruthy();

    infiniteState.data = { reports: [] };
    infiniteState.error = new Error('payload too large');
    rerender(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('XD')).toBeTruthy();
    expect(screen.queryByText('No pending reports')).toBeNull();
  });

  it('shows pending empty copy after a successful query with no rows', () => {
    infiniteState.data = { reports: [] };
    infiniteState.isLoading = false;
    pendingCountState.data = { reports: [] };
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('No pending reports')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Show all' }).length).toBe(1);
  });

  it('shows all-mode empty copy after switching with no rows', () => {
    infiniteState.data = { reports: [] };
    infiniteState.isLoading = false;
    pendingCountState.data = { reports: [] };
    render(<ReportReviewStatusPanel profile={manager} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('No reports in your stores for the last 30 days.')).toBeTruthy();
  });
});
