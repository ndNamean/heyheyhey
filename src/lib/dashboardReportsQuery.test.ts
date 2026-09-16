import { describe, expect, it } from 'vitest';
import { dashboardReportsQuery } from './dashboardReportsQuery';

describe('dashboardReportsQuery', () => {
  it('is released after holdDashLive', () => {
    expect(dashboardReportsQuery(true, '2026-08-31', '2026-09-16')).toBeNull();
  });

  it('scopes reports to the selected reportDate window', () => {
    expect(dashboardReportsQuery(false, '2026-08-31', '2026-09-16')).toEqual({
      reports: {
        $: { where: { reportDate: { $gte: '2026-08-31', $lte: '2026-09-16' } } },
        store: {},
      },
      stores: {},
    });
  });

  it('does not fall back to an unbounded reports snapshot', () => {
    expect(dashboardReportsQuery(false, '', '2026-09-16')).toBeNull();
    expect(dashboardReportsQuery(false, '2026-08-31', 'nope')).toBeNull();
  });
});
