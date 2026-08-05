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
  return { entryId: p.get('entryId')!, filter: p.get('filter') || 'my-assigned', storeId: p.get('storeId') || undefined };
}
export function serializeLogbookDeepLink(link: LogbookDeepLink): string { return JSON.stringify(link); }
export function parseLogbookDeepLinkJson(raw?: string): LogbookDeepLink | null { try { const x = JSON.parse(raw || ''); return x?.entryId ? x : null; } catch { return null; } }