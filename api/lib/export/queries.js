/**
 * Admin DB queries for export data.
 */

import { getAdminDb } from './instant-admin.js';
import { filterReportsByDate, filterReportsByStore } from './scope.js';

export async function fetchReportsWithResponses(allowedStoreIds, dateFilter) {
  const adminDb = getAdminDb();

  const query = {
    reports: {
      responses: {},
    },
  };

  if (dateFilter?.startDate && dateFilter?.endDate) {
    query.reports.$ = {
      where: {
        reportDate: { $gte: dateFilter.startDate, $lte: dateFilter.endDate },
      },
    };
  }

  const result = await adminDb.query(query);
  let reports = result.reports ?? [];
  reports = filterReportsByStore(reports, allowedStoreIds);

  if (!dateFilter && allowedStoreIds?.length) {
    reports = filterReportsByStore(reports, allowedStoreIds);
  } else if (!dateFilter) {
    reports = filterReportsByStore(reports, null);
  }

  return reports;
}

export async function fetchReviewStatusData(allowedStoreIds) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    reports: { responses: {} },
    reviewEvents: {},
    profiles: {},
  });

  const reports = filterReportsByStore(result.reports ?? [], allowedStoreIds);
  return {
    reports,
    reviewEvents: result.reviewEvents ?? [],
    profiles: result.profiles ?? [],
  };
}

export async function fetchMediaByResponseIds(responseIds) {
  if (!responseIds.length) return {};

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    mediaRecords: {},
  });

  const map = {};
  for (const m of result.mediaRecords ?? []) {
    if (!responseIds.includes(m.reportResponseId)) continue;
    if (!map[m.reportResponseId]) map[m.reportResponseId] = [];
    map[m.reportResponseId].push(m);
  }
  return map;
}

export async function fetchAllReportsForStores(allowedStoreIds) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    reports: { responses: {} },
  });
  return filterReportsByStore(result.reports ?? [], allowedStoreIds);
}
