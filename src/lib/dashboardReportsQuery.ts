/**
 * First Dashboard Instant receive: reports in the selected date window only.
 * After holdDashLive, the query is released and last-good keeps the snapshot.
 */
export function dashboardReportsQuery(holdDashLive: boolean, fromYmd: string, toYmd: string) {
  if (holdDashLive) return null;
  const from = String(fromYmd || '').slice(0, 10);
  const to = String(toYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return {
    reports: {
      $: {
        where: {
          reportDate: { $gte: from, $lte: to },
        },
      },
      store: {},
    },
    stores: {},
  };
}
