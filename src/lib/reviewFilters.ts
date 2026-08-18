/**
 * Lean client-side filters for the Review inbox (date presets + store).
 */

import { canAccessAllStores } from './roles';
import { todayYmd } from './utils';
import type { LogbookEntry, Profile, Report, RoleDefinition, Store } from '../types';

export type ReviewDatePreset = 'all' | 'today' | 'yesterday' | 'last2days' | 'last7days';

export interface ReviewDateRange {
  from: string;
  to: string;
}

export interface ReviewFilterState {
  datePreset: ReviewDatePreset;
  /** `'all'` or a store id */
  storeId: string;
}

export const REVIEW_DATE_PRESETS: ReviewDatePreset[] = [
  'all',
  'today',
  'yesterday',
  'last2days',
  'last7days',
];

function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function defaultReviewFilterState(): ReviewFilterState {
  return { datePreset: 'all', storeId: 'all' };
}

/** Resolve a preset to an inclusive YMD range, or `null` for All. */
export function resolveReviewDateRange(
  preset: ReviewDatePreset,
  today: string = todayYmd(),
): ReviewDateRange | null {
  switch (preset) {
    case 'all':
      return null;
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = ymdAddDays(today, -1);
      return { from: y, to: y };
    }
    case 'last2days':
      return { from: ymdAddDays(today, -1), to: today };
    case 'last7days':
      return { from: ymdAddDays(today, -6), to: today };
    default:
      return null;
  }
}

export function ymdInReviewRange(ymd: string, range: ReviewDateRange | null): boolean {
  if (!range) return true;
  const d = ymd.slice(0, 10);
  if (!d) return false;
  return d >= range.from && d <= range.to;
}

export function matchesReviewStore(storeId: string, filterStoreId: string): boolean {
  if (filterStoreId === 'all' || !filterStoreId) return true;
  return storeId === filterStoreId;
}

export function reportMatchesReviewFilters(
  report: Report,
  filters: ReviewFilterState,
  dateRange?: ReviewDateRange | null,
): boolean {
  const range = dateRange ?? resolveReviewDateRange(filters.datePreset);
  if (!matchesReviewStore(report.storeId, filters.storeId)) return false;
  return ymdInReviewRange(report.reportDate, range);
}

export function logbookIssueMatchesReviewFilters(
  entry: LogbookEntry,
  filters: ReviewFilterState,
  dateRange?: ReviewDateRange | null,
): boolean {
  const range = dateRange ?? resolveReviewDateRange(filters.datePreset);
  if (!matchesReviewStore(entry.storeId, filters.storeId)) return false;
  return ymdInReviewRange(entry.date, range);
}

export function filterReportsForReview(
  reports: Report[],
  filters: ReviewFilterState,
  options?: { keepReportIds?: string[]; today?: string },
): Report[] {
  const range = resolveReviewDateRange(filters.datePreset, options?.today);
  const keep = new Set(options?.keepReportIds ?? []);
  return reports.filter(
    (r) => keep.has(r.id) || reportMatchesReviewFilters(r, filters, range),
  );
}

export function filterLogbookIssuesForReview(
  issues: LogbookEntry[],
  filters: ReviewFilterState,
  options?: { keepEntryIds?: string[]; today?: string },
): LogbookEntry[] {
  const range = resolveReviewDateRange(filters.datePreset, options?.today);
  const keep = new Set(options?.keepEntryIds ?? []);
  return issues.filter(
    (e) => keep.has(e.id) || logbookIssueMatchesReviewFilters(e, filters, range),
  );
}

export function isReviewFilterActive(filters: ReviewFilterState): boolean {
  return filters.datePreset !== 'all' || (filters.storeId !== 'all' && !!filters.storeId);
}

/**
 * Store catalog for the Review store picker — scoped users use linked profile stores
 * so the picker stays stable when the reports query refresh fails.
 */
export function resolveReviewStoreCatalog(
  profile: Profile,
  defs: RoleDefinition[],
  queryStores: Store[],
): Store[] {
  if (canAccessAllStores(profile.role, defs)) return queryStores;
  return profile.stores ?? [];
}

export type ReviewFilterChipKind = 'date' | 'store';

export interface ReviewFilterChip {
  id: string;
  kind: ReviewFilterChipKind;
  label: string;
}

export interface ReviewFilterChipLabels {
  datePreset: Partial<Record<ReviewDatePreset, string>>;
  storeLabel?: string;
}

/** Count active filter dimensions (0–2: date preset + store). */
export function countActiveReviewFilters(filters: ReviewFilterState): number {
  let count = 0;
  if (filters.datePreset !== 'all') count++;
  if (filters.storeId !== 'all' && !!filters.storeId) count++;
  return count;
}

/** Build removable chip descriptors for collapsed filter UI. */
export function listReviewFilterChips(
  filters: ReviewFilterState,
  labels: ReviewFilterChipLabels,
): ReviewFilterChip[] {
  const chips: ReviewFilterChip[] = [];
  if (filters.datePreset !== 'all') {
    chips.push({
      id: 'date',
      kind: 'date',
      label: labels.datePreset[filters.datePreset] ?? filters.datePreset,
    });
  }
  if (filters.storeId !== 'all' && !!filters.storeId && labels.storeLabel) {
    chips.push({ id: 'store', kind: 'store', label: labels.storeLabel });
  }
  return chips;
}

/** Clear one filter dimension, leaving others unchanged. */
export function clearReviewFilterChip(
  filters: ReviewFilterState,
  kind: ReviewFilterChipKind,
): ReviewFilterState {
  if (kind === 'date') return { ...filters, datePreset: 'all' };
  return { ...filters, storeId: 'all' };
}
