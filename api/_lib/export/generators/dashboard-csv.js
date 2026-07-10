/**
 * Dashboard CSV generator.
 */

import { buildCsv } from '../csv-builder.js';
import {
  fetchReportsWithResponses,
  fetchMediaByResponseIds,
} from '../queries.js';
import {
  DASHBOARD_CSV_HEADERS,
  mapDashboardRows,
} from '../row-mappers.js';
import { resolveDashboardScope } from '../scope.js';

export async function generateDashboardCsv(profileCtx, params) {
  const scopeResult = resolveDashboardScope(profileCtx, params);
  const { allowedStoreIds, dateFilter } = scopeResult;

  const reports = await fetchReportsWithResponses(allowedStoreIds, dateFilter);

  const responseIds = [];
  for (const r of reports) {
    for (const resp of r.responses ?? []) {
      responseIds.push(resp.id);
    }
  }

  const mediaByResponseId = await fetchMediaByResponseIds(responseIds);
  const rows = mapDashboardRows(reports, mediaByResponseId);
  const result = buildCsv(DASHBOARD_CSV_HEADERS, rows);

  return {
    ...result,
    scopeResult,
    reports,
  };
}
