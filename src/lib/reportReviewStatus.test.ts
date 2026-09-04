import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATUS_DAYS_BACK,
  REVIEW_STATUS_PAGE_SIZE,
  REVIEW_STATUS_PENDING_COUNT_LIMIT,
  buildReportReviewStatusListWhere,
  buildReportReviewStatusPendingWhere,
  buildReportReviewStatusWhere,
  formatReviewStatusPendingBadge,
  reviewStatusDateWindow,
} from './reportReviewStatus';

describe('reviewStatusDateWindow', () => {
  it('uses an inclusive UTC YYYY-MM-DD window of daysBack', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    expect(reviewStatusDateWindow(30, now)).toEqual({
      start: '2026-07-28',
      end: '2026-08-27',
    });
  });
});

describe('buildReportReviewStatusWhere', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const { start, end } = reviewStatusDateWindow(REVIEW_STATUS_DAYS_BACK, now);
  const reportDate = { $gte: start, $lte: end };

  it('scopes store-limited reviewers to assigned stores and the date window', () => {
    expect(
      buildReportReviewStatusWhere({
        canAccessAllStores: false,
        storeIds: ['store-a', 'store-a', ''],
        now,
      }),
    ).toEqual({
      storeId: { $in: ['store-a'] },
      reportDate,
    });
  });

  it('skips the reports query when a store-scoped reviewer has no stores', () => {
    expect(
      buildReportReviewStatusWhere({
        canAccessAllStores: false,
        storeIds: [],
        now,
      }),
    ).toBeNull();
  });

  it('uses only the date window for all-store access', () => {
    expect(
      buildReportReviewStatusWhere({
        canAccessAllStores: true,
        storeIds: [],
        now,
      }),
    ).toEqual({ reportDate });
  });
});

describe('buildReportReviewStatusPendingWhere', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const { start, end } = reviewStatusDateWindow(REVIEW_STATUS_DAYS_BACK, now);
  const reportDate = { $gte: start, $lte: end };

  it('adds waiting_approval to the store/date where', () => {
    expect(
      buildReportReviewStatusPendingWhere({
        canAccessAllStores: false,
        storeIds: ['store-a'],
        now,
      }),
    ).toEqual({
      storeId: { $in: ['store-a'] },
      reportDate,
      status: 'waiting_approval',
    });
  });

  it('returns null when base where is null', () => {
    expect(
      buildReportReviewStatusPendingWhere({
        canAccessAllStores: false,
        storeIds: [],
        now,
      }),
    ).toBeNull();
  });
});

describe('buildReportReviewStatusListWhere', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const { start, end } = reviewStatusDateWindow(REVIEW_STATUS_DAYS_BACK, now);
  const reportDate = { $gte: start, $lte: end };

  it('pending mode filters waiting_approval', () => {
    expect(
      buildReportReviewStatusListWhere(
        { canAccessAllStores: true, storeIds: [], now },
        'pending',
      ),
    ).toEqual({ reportDate, status: 'waiting_approval' });
  });

  it('all mode omits status filter', () => {
    expect(
      buildReportReviewStatusListWhere(
        { canAccessAllStores: true, storeIds: [], now },
        'all',
      ),
    ).toEqual({ reportDate });
  });
});

describe('formatReviewStatusPendingBadge', () => {
  it('returns the exact count under the soft ceiling', () => {
    expect(formatReviewStatusPendingBadge(23)).toBe('23');
    expect(formatReviewStatusPendingBadge(REVIEW_STATUS_PENDING_COUNT_LIMIT - 1)).toBe('999');
  });

  it('shows 1000+ when the soft ceiling is hit', () => {
    expect(formatReviewStatusPendingBadge(REVIEW_STATUS_PENDING_COUNT_LIMIT)).toBe('1000+');
    expect(formatReviewStatusPendingBadge(REVIEW_STATUS_PENDING_COUNT_LIMIT + 50)).toBe('1000+');
  });
});

describe('REVIEW_STATUS_PAGE_SIZE', () => {
  it('pages at 20', () => {
    expect(REVIEW_STATUS_PAGE_SIZE).toBe(20);
  });
});
