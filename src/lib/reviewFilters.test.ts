import { describe, expect, it } from 'vitest';
import {
  clearReviewFilterChip,
  countActiveReviewFilters,
  defaultReviewFilterState,
  filterLogbookIssuesForReview,
  filterReportsForReview,
  isReviewFilterActive,
  listReviewFilterChips,
  logbookIssueMatchesReviewFilters,
  matchesReviewStore,
  reportMatchesReviewFilters,
  resolveReviewStoreCatalog,
  resolveReviewDateRange,
  ymdInReviewRange,
} from './reviewFilters';
import type { LogbookEntry, Profile, Report, Store } from '../types';

const TODAY = '2026-08-18';

function report(partial: Partial<Report> & Pick<Report, 'id'>): Report {
  return {
    storeId: partial.storeId ?? 's1',
    storeCode: partial.storeCode ?? 'TKC',
    storeName: partial.storeName ?? 'Store',
    templateId: partial.templateId ?? 't1',
    templateName: partial.templateName ?? 'Daily',
    reportType: partial.reportType ?? 'daily',
    reportDate: partial.reportDate ?? TODAY,
    submittedByUserId: partial.submittedByUserId ?? 'u1',
    submittedByRole: partial.submittedByRole ?? 'manager',
    submittedAt: partial.submittedAt ?? `${TODAY}T08:00:00.000Z`,
    status: partial.status ?? 'waiting_approval',
    completionPercent: partial.completionPercent ?? 100,
    compliancePercent: partial.compliancePercent ?? 100,
    archived: partial.archived ?? false,
    archiveMonth: partial.archiveMonth ?? '',
    createdAt: partial.createdAt ?? `${TODAY}T08:00:00.000Z`,
    updatedAt: partial.updatedAt ?? `${TODAY}T08:00:00.000Z`,
    ...partial,
  };
}

function issue(partial: Partial<LogbookEntry> & Pick<LogbookEntry, 'id'>): LogbookEntry {
  return {
    storeId: partial.storeId ?? 's1',
    authorUserId: partial.authorUserId ?? 'u1',
    date: partial.date ?? TODAY,
    shift: partial.shift ?? 'AM',
    content: partial.content ?? 'Issue',
    severity: partial.severity ?? 'warning',
    isAnnouncement: partial.isAnnouncement ?? false,
    requiresAck: partial.requiresAck ?? false,
    ackUserIdsJson: partial.ackUserIdsJson ?? '[]',
    createdAt: partial.createdAt ?? `${TODAY}T08:00:00.000Z`,
    updatedAt: partial.updatedAt ?? `${TODAY}T08:00:00.000Z`,
    ...partial,
  };
}

describe('resolveReviewDateRange', () => {
  it('returns null for all', () => {
    expect(resolveReviewDateRange('all', TODAY)).toBeNull();
  });

  it('resolves today', () => {
    expect(resolveReviewDateRange('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('resolves yesterday', () => {
    expect(resolveReviewDateRange('yesterday', TODAY)).toEqual({
      from: '2026-08-17',
      to: '2026-08-17',
    });
  });

  it('resolves last 2 days as a rolling window including today', () => {
    expect(resolveReviewDateRange('last2days', TODAY)).toEqual({
      from: '2026-08-17',
      to: TODAY,
    });
  });

  it('resolves last 7 days as a rolling window including today', () => {
    expect(resolveReviewDateRange('last7days', TODAY)).toEqual({
      from: '2026-08-12',
      to: TODAY,
    });
  });
});

describe('ymdInReviewRange', () => {
  it('accepts any date when range is null', () => {
    expect(ymdInReviewRange('2020-01-01', null)).toBe(true);
  });

  it('checks inclusive bounds', () => {
    const range = { from: '2026-08-17', to: TODAY };
    expect(ymdInReviewRange('2026-08-16', range)).toBe(false);
    expect(ymdInReviewRange('2026-08-17', range)).toBe(true);
    expect(ymdInReviewRange(TODAY, range)).toBe(true);
    expect(ymdInReviewRange('2026-08-19', range)).toBe(false);
  });
});

describe('matchesReviewStore', () => {
  it('passes when filter is all', () => {
    expect(matchesReviewStore('s1', 'all')).toBe(true);
  });

  it('matches exact store id', () => {
    expect(matchesReviewStore('s1', 's1')).toBe(true);
    expect(matchesReviewStore('s2', 's1')).toBe(false);
  });
});

describe('reportMatchesReviewFilters', () => {
  const filters = { datePreset: 'today' as const, storeId: 's1' };

  it('matches report on date and store', () => {
    expect(reportMatchesReviewFilters(report({ id: 'r1' }), filters, { from: TODAY, to: TODAY })).toBe(
      true,
    );
  });

  it('rejects wrong store', () => {
    expect(
      reportMatchesReviewFilters(
        report({ id: 'r1', storeId: 's2' }),
        filters,
        { from: TODAY, to: TODAY },
      ),
    ).toBe(false);
  });

  it('rejects date outside range', () => {
    expect(
      reportMatchesReviewFilters(
        report({ id: 'r1', reportDate: '2026-08-01' }),
        filters,
        { from: TODAY, to: TODAY },
      ),
    ).toBe(false);
  });
});

describe('logbookIssueMatchesReviewFilters', () => {
  const filters = { datePreset: 'last7days' as const, storeId: 'all' };

  it('matches entry date within range', () => {
    expect(
      logbookIssueMatchesReviewFilters(
        issue({ id: 'e1', date: '2026-08-12' }),
        filters,
        resolveReviewDateRange('last7days', TODAY),
      ),
    ).toBe(true);
  });

  it('rejects entry date before range', () => {
    expect(
      logbookIssueMatchesReviewFilters(
        issue({ id: 'e1', date: '2026-08-01' }),
        filters,
        resolveReviewDateRange('last7days', TODAY),
      ),
    ).toBe(false);
  });
});

describe('filterReportsForReview', () => {
  it('keeps highlighted report outside filter', () => {
    const reports = [
      report({ id: 'r-old', reportDate: '2026-01-01', storeId: 's2' }),
      report({ id: 'r-today', reportDate: TODAY, storeId: 's1' }),
    ];
    const filtered = filterReportsForReview(
      reports,
      { datePreset: 'today', storeId: 's1' },
      { keepReportIds: ['r-old'], today: TODAY },
    );
    expect(filtered.map((r) => r.id).sort()).toEqual(['r-old', 'r-today']);
  });
});

describe('filterLogbookIssuesForReview', () => {
  it('narrows by store and date', () => {
    const issues = [
      issue({ id: 'e1', date: TODAY, storeId: 's1' }),
      issue({ id: 'e2', date: TODAY, storeId: 's2' }),
      issue({ id: 'e3', date: '2026-01-01', storeId: 's1' }),
    ];
    const filtered = filterLogbookIssuesForReview(
      issues,
      { datePreset: 'today', storeId: 's1' },
      { today: TODAY },
    );
    expect(filtered.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('isReviewFilterActive', () => {
  it('is false for defaults', () => {
    expect(isReviewFilterActive(defaultReviewFilterState())).toBe(false);
  });

  it('is true when date preset is narrowed', () => {
    expect(isReviewFilterActive({ datePreset: 'today', storeId: 'all' })).toBe(true);
  });

  it('is true when store is narrowed', () => {
    expect(isReviewFilterActive({ datePreset: 'all', storeId: 's1' })).toBe(true);
  });
});

describe('countActiveReviewFilters', () => {
  it('returns 0 for defaults', () => {
    expect(countActiveReviewFilters(defaultReviewFilterState())).toBe(0);
  });

  it('returns 1 when only date is narrowed', () => {
    expect(countActiveReviewFilters({ datePreset: 'today', storeId: 'all' })).toBe(1);
  });

  it('returns 1 when only store is narrowed', () => {
    expect(countActiveReviewFilters({ datePreset: 'all', storeId: 's1' })).toBe(1);
  });

  it('returns 2 when both are narrowed', () => {
    expect(countActiveReviewFilters({ datePreset: 'today', storeId: 's1' })).toBe(2);
  });
});

describe('listReviewFilterChips', () => {
  const labels = {
    datePreset: { today: 'Today', yesterday: 'Yesterday' },
    storeLabel: 'HP-VO — Store Name',
  };

  it('returns empty list for defaults', () => {
    expect(listReviewFilterChips(defaultReviewFilterState(), labels)).toEqual([]);
  });

  it('includes date chip when preset is narrowed', () => {
    expect(listReviewFilterChips({ datePreset: 'today', storeId: 'all' }, labels)).toEqual([
      { id: 'date', kind: 'date', label: 'Today' },
    ]);
  });

  it('includes store chip when store is narrowed', () => {
    expect(listReviewFilterChips({ datePreset: 'all', storeId: 's1' }, labels)).toEqual([
      { id: 'store', kind: 'store', label: 'HP-VO — Store Name' },
    ]);
  });

  it('includes both chips when both are narrowed', () => {
    expect(listReviewFilterChips({ datePreset: 'today', storeId: 's1' }, labels)).toEqual([
      { id: 'date', kind: 'date', label: 'Today' },
      { id: 'store', kind: 'store', label: 'HP-VO — Store Name' },
    ]);
  });

  it('omits store chip when storeLabel is missing', () => {
    expect(
      listReviewFilterChips(
        { datePreset: 'all', storeId: 's1' },
        { datePreset: labels.datePreset },
      ),
    ).toEqual([]);
  });
});

describe('clearReviewFilterChip', () => {
  it('clears date preset only', () => {
    expect(clearReviewFilterChip({ datePreset: 'today', storeId: 's1' }, 'date')).toEqual({
      datePreset: 'all',
      storeId: 's1',
    });
  });

  it('clears store only', () => {
    expect(clearReviewFilterChip({ datePreset: 'today', storeId: 's1' }, 'store')).toEqual({
      datePreset: 'today',
      storeId: 'all',
    });
  });
});

describe('resolveReviewStoreCatalog', () => {
  const storeA = { id: 's1', code: 'A', name: 'Alpha' } as Store;
  const storeB = { id: 's2', code: 'B', name: 'Beta' } as Store;
  const profile = {
    role: 'manager',
    stores: [storeA, storeB],
  } as Profile;
  const ownerProfile = { role: 'owner', stores: [] } as Profile;
  const defs = [
    { key: 'owner', canAccessAllStores: true, active: true },
    { key: 'manager', canAccessAllStores: false, active: true },
  ] as import('../types').RoleDefinition[];

  it('uses profile stores for scoped reviewers', () => {
    expect(resolveReviewStoreCatalog(profile, defs, [])).toEqual([storeA, storeB]);
  });

  it('uses query stores for all-store access roles', () => {
    const queryStores = [
      { id: 's1', code: 'A', name: 'Alpha' },
      { id: 's2', code: 'B', name: 'Beta' },
      { id: 's3', code: 'C', name: 'Charlie' },
    ] as Store[];
    expect(resolveReviewStoreCatalog(ownerProfile, defs, queryStores)).toEqual(queryStores);
  });
});
