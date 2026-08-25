import { db } from '../db';
import type { ReportNeedsActionCount } from '../types';

/**
 * Subscribe to the per-user My Reports Needs action counter (badge).
 * Does not scan the reports collection.
 */
export function useReportNeedsActionCount(userId: string): {
  needsActionCount: number;
  row: ReportNeedsActionCount | null;
  isLoading: boolean;
} {
  const { data, isLoading } = db.useQuery(
    userId
      ? {
          reportNeedsActionCounts: {
            $: { where: { userId } },
          },
        }
      : null,
  );
  const row = ((data?.reportNeedsActionCounts ?? [])[0] ?? null) as ReportNeedsActionCount | null;
  const needsActionCount =
    row && typeof row.needsActionCount === 'number' && Number.isFinite(row.needsActionCount)
      ? Math.max(0, Math.floor(row.needsActionCount))
      : 0;
  return { needsActionCount, row, isLoading: Boolean(userId) && Boolean(isLoading) };
}
