/**
 * Server-side store scoping for exports.
 */

const MASTER_ROLES = new Set(['owner', 'areaManager']);

export function resolveDashboardScope(profileCtx, params) {
  const { role, storeIds: assignedStoreIds } = profileCtx;
  const scope = params.scope === 'full_history' ? 'full_history' : 'filtered';
  const filterStoreId = params.filterStoreId === 'all' || !params.filterStoreId
    ? 'all'
    : params.filterStoreId;

  let allowedStoreIds = null;

  if (MASTER_ROLES.has(role)) {
    if (filterStoreId !== 'all') {
      allowedStoreIds = [filterStoreId];
    }
  } else {
    allowedStoreIds = assignedStoreIds;
    if (filterStoreId !== 'all' && assignedStoreIds.includes(filterStoreId)) {
      allowedStoreIds = [filterStoreId];
    }
  }

  const dateFilter =
    scope === 'full_history'
      ? null
      : {
          startDate: params.startDate,
          endDate: params.endDate,
        };

  if (scope === 'filtered' && (!params.startDate || !params.endDate)) {
    const err = new Error('startDate and endDate required for filtered scope');
    err.status = 400;
    throw err;
  }

  return {
    scope,
    allowedStoreIds,
    dateFilter,
    filterStoreId,
    storeScopeJson: JSON.stringify({
      allowedStoreIds,
      filterStoreId,
      scope,
    }),
    dateRangeJson: JSON.stringify(
      dateFilter ?? { startDate: null, endDate: null, allTime: true },
    ),
  };
}

export function resolveReviewStatusScope(profileCtx, params) {
  const { storeIds: assignedStoreIds } = profileCtx;

  if (!assignedStoreIds.length) {
    const err = new Error('No stores assigned to this user');
    err.status = 403;
    throw err;
  }

  const scope = params.scope === 'all_assigned' ? 'all_assigned' : 'current_list';
  const daysBack = Number(params.daysBack) > 0 ? Number(params.daysBack) : 30;
  const limit = scope === 'current_list'
    ? (Number(params.limit) > 0 ? Number(params.limit) : 200)
    : null;

  return {
    scope,
    allowedStoreIds: assignedStoreIds,
    daysBack: scope === 'current_list' ? daysBack : null,
    limit,
    storeScopeJson: JSON.stringify({ allowedStoreIds: assignedStoreIds }),
    dateRangeJson: JSON.stringify(
      scope === 'current_list'
        ? { daysBack, limit }
        : { allTime: true },
    ),
  };
}

export function filterReportsByStore(reports, allowedStoreIds) {
  if (!allowedStoreIds) return reports;
  const set = new Set(allowedStoreIds);
  return reports.filter((r) => set.has(r.storeId));
}

export function filterReportsByDate(reports, dateFilter) {
  if (!dateFilter) return reports;
  const { startDate, endDate } = dateFilter;
  return reports.filter(
    (r) => r.reportDate >= startDate && r.reportDate <= endDate,
  );
}
