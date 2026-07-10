/**
 * Review status CSV generator.
 */

import { buildCsv } from '../csv-builder.js';
import { fetchReviewStatusData } from '../queries.js';
import {
  REVIEW_STATUS_CSV_HEADERS,
  mapReviewStatusRows,
} from '../row-mappers.js';
import { resolveReviewStatusScope } from '../scope.js';
import { buildReviewStatusRows } from '../review-status-rows.js';

export async function generateReviewStatusCsv(profileCtx, params) {
  const scopeResult = resolveReviewStatusScope(profileCtx, params);
  const { allowedStoreIds, daysBack, limit, scope } = scopeResult;

  const { reports, reviewEvents, profiles } = await fetchReviewStatusData(allowedStoreIds);

  const statusRows = buildReviewStatusRows(reports, profiles, reviewEvents, {
    daysBack: daysBack ?? 30,
    limit: limit ?? 200,
    scope,
  });

  const rows = mapReviewStatusRows(statusRows);
  const result = buildCsv(REVIEW_STATUS_CSV_HEADERS, rows);

  return {
    ...result,
    scopeResult,
    statusRows,
    reports,
  };
}
