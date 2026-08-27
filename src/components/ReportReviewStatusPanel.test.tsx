/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Profile, Report, Store } from '../types';

const { queryCalls, reportsState } = vi.hoisted(() => ({
  queryCalls: [] as unknown[],
  reportsState: {
    data: null as { reports: Report[] } | null,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('../db', () => ({
  db: {
    useQuery: (query: Record<string, unknown> | null) => {
      queryCalls.push(query);
      if (!query) return { data: null, isLoading: false, error: null };
      if ('reports' in query) return reportsState;
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

function lastReportsQuery(): {
  reports: { $?: { where?: Record<string, unknown>; limit?: number; order?: unknown } };
} | null {
  for (let i = queryCalls.length - 1; i >= 0; i--) {
    const q = queryCalls[i];
    if (q && typeof q === 'object' && 'reports' in q) {
      return q as {
        reports: { $?: { where?: Record<string, unknown>; limit?: number; order?: unknown } };
      };
    }
  }
  return null;
}

describe('ReportReviewStatusPanel query scoping', () => {
  beforeEach(() => {
    cleanup();
    queryCalls.length = 0;
    reportsState.data = null;
    reportsState.isLoading = false;
    reportsState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('scopes the Instant reports query to assigned stores and a date window', () => {
    reportsState.data = { reports: [reportInWindow()] };
    render(<ReportReviewStatusPanel profile={manager} />);
    const query = lastReportsQuery();
    expect(query?.reports.$?.where).toMatchObject({
      storeId: { $in: ['store-a'] },
    });
    expect(query?.reports.$?.where?.reportDate).toMatchObject({
      $gte: expect.any(String),
      $lte: expect.any(String),
    });
    expect(query?.reports.$?.limit).toBe(200);
    expect(query?.reports.$?.order).toEqual({ submittedAt: 'desc' });
    expect(screen.getByText('XD')).toBeTruthy();
  });

  it('does not subscribe to reports when the manager has no stores', () => {
    render(<ReportReviewStatusPanel profile={{ ...manager, stores: [] }} />);
    expect(lastReportsQuery()).toBeNull();
    expect(screen.getByText('No reports in your stores for the last 30 days.')).toBeTruthy();
  });

  it('shows loading instead of the empty copy while the first fetch is in flight', () => {
    reportsState.isLoading = true;
    reportsState.data = null;
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No reports in your stores for the last 30 days.')).toBeNull();
  });

  it('treats a missing first result as loading, not empty', () => {
    reportsState.isLoading = false;
    reportsState.data = null;
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No reports in your stores for the last 30 days.')).toBeNull();
  });

  it('keeps last-good rows when a later query errors empty', () => {
    reportsState.data = { reports: [reportInWindow()] };
    const { rerender } = render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('XD')).toBeTruthy();

    reportsState.data = { reports: [] };
    reportsState.error = new Error('payload too large');
    rerender(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('XD')).toBeTruthy();
    expect(screen.queryByText('No reports in your stores for the last 30 days.')).toBeNull();
  });

  it('shows the empty copy after a successful query with no rows', () => {
    reportsState.data = { reports: [] };
    reportsState.isLoading = false;
    render(<ReportReviewStatusPanel profile={manager} />);
    expect(screen.getByText('No reports in your stores for the last 30 days.')).toBeTruthy();
  });
});
