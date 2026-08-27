import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATUS_DAYS_BACK,
  buildReportReviewStatusWhere,
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
