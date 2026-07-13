/**
 * Failure history CSV generator.
 */

import { buildCsv } from '../csv-builder.js';
import { fetchReviewStatusData } from '../queries.js';
import {
  buildIssueInstancesForExport,
  filterIssueInstances,
} from '../failure-history-aggregate.js';
import {
  FAILURE_HISTORY_CSV_HEADERS,
  mapFailureHistoryRows,
} from '../row-mappers.js';
import { resolveDashboardScope } from '../scope.js';

export async function generateFailureHistoryCsv(profileCtx, params) {
  const scopeResult = resolveDashboardScope(profileCtx, params);
  const { allowedStoreIds, dateFilter } = scopeResult;

  const { reports, reviewEvents, profiles } = await fetchReviewStatusData(allowedStoreIds);

  const allInstances = buildIssueInstancesForExport(reviewEvents, reports, profiles);

  const instances =
    dateFilter?.startDate && dateFilter?.endDate
      ? filterIssueInstances(allInstances, {
          startDate: dateFilter.startDate,
          endDate: dateFilter.endDate,
          storeIds: allowedStoreIds,
        })
      : allInstances.filter((inst) => {
          if (allowedStoreIds?.length && !allowedStoreIds.includes(inst.storeId)) return false;
          return true;
        });

  const rows = mapFailureHistoryRows(instances);
  const result = buildCsv(FAILURE_HISTORY_CSV_HEADERS, rows);

  return {
    ...result,
    scopeResult,
    reports,
    instances,
  };
}
