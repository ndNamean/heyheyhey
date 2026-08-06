export const OPEN_LOGBOOK_EVENT = 'heyPelo:openLogbook';

export type LogbookDeepLink = { entryId: string; filter: string; storeId?: string };

export function buildLogbookDeepLinkUrl({ entryId, filter, storeId }: LogbookDeepLink): string {
  const params = new URLSearchParams({ open: 'logbook', entryId, filter });
  if (storeId) params.set('storeId', storeId);
  return `/?${params.toString()}`;
}

export function parseLogbookDeepLinkFromSearch(search: string): LogbookDeepLink | null {
  const p = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  if (p.get('open') !== 'logbook' || !p.get('entryId')) return null;
  return {
    entryId: p.get('entryId')!,
    filter: p.get('filter') || 'my-assigned',
    storeId: p.get('storeId') || undefined,
  };
}

export function serializeLogbookDeepLink(link: LogbookDeepLink): string {
  return JSON.stringify(link);
}

export function parseLogbookDeepLinkJson(raw?: string): LogbookDeepLink | null {
  try {
    const x = JSON.parse(raw || '');
    return x?.entryId ? (x as LogbookDeepLink) : null;
  } catch {
    return null;
  }
}

/**
 * Map Store Chat `logbookEventType` (short) or inbox notification type (prefixed)
 * to a Logbook deep-link filter key.
 */
export function filterForLogbookEventType(eventType?: string): string {
  const t = String(eventType || '').trim();
  if (
    t === 'resolution_submitted' ||
    t === 'logbook_resolution_submitted'
  ) {
    return 'waiting_approval';
  }
  if (
    t === 'ack_required' ||
    t === 'logbook_ack_required' ||
    t === 'logbook_note_created' ||
    t === 'logbook_announcement_created'
  ) {
    return 'requires_ack';
  }
  return 'my-assigned';
}

/** Ensure a non-empty deepLinkJson string for notify/chat writes. */
export function ensureLogbookDeepLinkJson(opts: {
  deepLinkJson?: string;
  entryId: string;
  filter?: string;
  storeId?: string;
  eventType?: string;
}): string {
  const existing = String(opts.deepLinkJson || '').trim();
  if (existing) {
    const parsed = parseLogbookDeepLinkJson(existing);
    if (parsed?.entryId) return existing;
  }
  const entryId = String(opts.entryId || '').trim();
  if (!entryId) return existing;
  return serializeLogbookDeepLink({
    entryId,
    filter:
      String(opts.filter || '').trim() ||
      filterForLogbookEventType(opts.eventType),
    storeId: opts.storeId || undefined,
  });
}

/**
 * Resolve a deep link from a Store Chat logbook_system message.
 * Prefers deepLinkJson; falls back to logbookEntryId + event-type filter.
 */
export function resolveStoreChatLogbookDeepLink(message: {
  deepLinkJson?: string;
  logbookEntryId?: string;
  logbookEventType?: string;
  storeId?: string;
}): LogbookDeepLink | null {
  const parsed = parseLogbookDeepLinkJson(message.deepLinkJson);
  if (parsed?.entryId) {
    return {
      entryId: parsed.entryId,
      filter:
        String(parsed.filter || '').trim() ||
        filterForLogbookEventType(message.logbookEventType),
      storeId: parsed.storeId || message.storeId || undefined,
    };
  }
  const entryId = String(message.logbookEntryId || '').trim();
  if (!entryId) return null;
  return {
    entryId,
    filter: filterForLogbookEventType(message.logbookEventType),
    storeId: message.storeId || undefined,
  };
}

/** Merge props + session into the highlight/filter keys for a Logbook open. */
export function resolveLogbookOpenState(opts: {
  highlightEntryId?: string | null;
  initialFilter?: string;
  sessionHighlight?: string | null;
  sessionFilter?: string | null;
}): { highlightId: string | null; filterKey: string } {
  const highlightId =
    String(opts.highlightEntryId || opts.sessionHighlight || '').trim() || null;
  const filterKey = String(opts.initialFilter || opts.sessionFilter || '').trim();
  return { highlightId, filterKey };
}