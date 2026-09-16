/**
 * Hold the Dashboard reports subscription only after Instant returns real
 * reports or stores. An empty first snapshot is not a completed receive.
 */
export function shouldHoldDashLive(
  reportsData: { reports?: unknown[] | null; stores?: unknown[] | null } | null | undefined,
  reportsError: unknown,
): boolean {
  if (reportsError || !reportsData) return false;
  const reports = reportsData.reports;
  const stores = reportsData.stores;
  return (Array.isArray(reports) && reports.length > 0) || (Array.isArray(stores) && stores.length > 0);
}
