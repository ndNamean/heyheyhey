export const OPEN_REVIEW_REPORT_EVENT = 'heyPelo:openReviewReport';

export type ReportDeepLink = {
  page?: 'review';
  surface?: 'reports';
  reportId: string;
  storeId?: string;
};

export function buildReportDeepLinkUrl({ reportId, storeId }: ReportDeepLink): string {
  const params = new URLSearchParams({
    open: 'review',
    surface: 'reports',
    reportId,
  });
  if (storeId) params.set('storeId', storeId);
  return `/?${params.toString()}`;
}

export function parseReportDeepLinkFromSearch(search: string): ReportDeepLink | null {
  const p = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  if (p.get('open') !== 'review' || !p.get('reportId')) return null;
  return {
    page: 'review',
    surface: (p.get('surface') as 'reports') || 'reports',
    reportId: p.get('reportId')!,
    storeId: p.get('storeId') || undefined,
  };
}

export function serializeReportDeepLink(link: ReportDeepLink): string {
  return JSON.stringify({
    page: 'review',
    surface: 'reports',
    reportId: link.reportId,
    storeId: link.storeId || undefined,
  });
}

export function parseReportDeepLinkJson(raw?: string): ReportDeepLink | null {
  try {
    const x = JSON.parse(raw || '');
    if (!x?.reportId) return null;
    return {
      page: 'review',
      surface: 'reports',
      reportId: String(x.reportId),
      storeId: x.storeId ? String(x.storeId) : undefined,
    };
  } catch {
    return null;
  }
}

/** Ensure a non-empty deepLinkJson string for report chat writes. */
export function ensureReportDeepLinkJson(opts: {
  deepLinkJson?: string;
  reportId: string;
  storeId?: string;
}): string {
  const existing = String(opts.deepLinkJson || '').trim();
  if (existing) {
    const parsed = parseReportDeepLinkJson(existing);
    if (parsed?.reportId) return existing;
  }
  const reportId = String(opts.reportId || '').trim();
  if (!reportId) return existing;
  return serializeReportDeepLink({
    reportId,
    storeId: opts.storeId || undefined,
  });
}

/**
 * Resolve a deep link from a Store Chat report_system message.
 * Prefers deepLinkJson; falls back to reportId field.
 */
export function resolveStoreChatReportDeepLink(message: {
  deepLinkJson?: string;
  reportId?: string;
  storeId?: string;
}): ReportDeepLink | null {
  const parsed = parseReportDeepLinkJson(message.deepLinkJson);
  if (parsed?.reportId) {
    return {
      page: 'review',
      surface: 'reports',
      reportId: parsed.reportId,
      storeId: parsed.storeId || message.storeId || undefined,
    };
  }
  const reportId = String(message.reportId || '').trim();
  if (!reportId) return null;
  return {
    page: 'review',
    surface: 'reports',
    reportId,
    storeId: message.storeId || undefined,
  };
}
