import { describe, expect, it } from 'vitest';
import {
  ensureLogbookDeepLinkJson,
  filterForLogbookEventType,
  parseLogbookDeepLinkJson,
  resolveLogbookOpenState,
  resolveStoreChatLogbookDeepLink,
} from './logbookDeepLink';

describe('logbookDeepLink fallbacks', () => {
  it('maps event types to filters', () => {
    expect(filterForLogbookEventType('ack_required')).toBe('requires_ack');
    expect(filterForLogbookEventType('logbook_ack_required')).toBe('requires_ack');
    expect(filterForLogbookEventType('resolution_submitted')).toBe('waiting_approval');
    expect(filterForLogbookEventType('issue_assigned')).toBe('my-assigned');
  });

  it('resolves deep link from logbookEntryId when JSON missing', () => {
    const link = resolveStoreChatLogbookDeepLink({
      deepLinkJson: '',
      logbookEntryId: 'entry-1',
      logbookEventType: 'ack_required',
      storeId: 'store-1',
    });
    expect(link).toEqual({
      entryId: 'entry-1',
      filter: 'requires_ack',
      storeId: 'store-1',
    });
  });

  it('prefers valid deepLinkJson over fallback', () => {
    const link = resolveStoreChatLogbookDeepLink({
      deepLinkJson: JSON.stringify({ entryId: 'e2', filter: 'waiting_approval', storeId: 's2' }),
      logbookEntryId: 'ignored',
      logbookEventType: 'ack_required',
    });
    expect(link).toEqual({
      entryId: 'e2',
      filter: 'waiting_approval',
      storeId: 's2',
    });
  });

  it('ensureLogbookDeepLinkJson synthesizes when empty', () => {
    const raw = ensureLogbookDeepLinkJson({
      deepLinkJson: '',
      entryId: 'abc',
      eventType: 'resolution_submitted',
      storeId: 's1',
    });
    expect(parseLogbookDeepLinkJson(raw)).toEqual({
      entryId: 'abc',
      filter: 'waiting_approval',
      storeId: 's1',
    });
  });

  it('resolveLogbookOpenState prefers props then session', () => {
    expect(
      resolveLogbookOpenState({
        highlightEntryId: 'h1',
        initialFilter: 'requires_ack',
        sessionHighlight: 'old',
        sessionFilter: 'my-assigned',
      }),
    ).toEqual({ highlightId: 'h1', filterKey: 'requires_ack' });
    expect(
      resolveLogbookOpenState({
        highlightEntryId: null,
        initialFilter: undefined,
        sessionHighlight: 'from-session',
        sessionFilter: 'waiting_approval',
      }),
    ).toEqual({ highlightId: 'from-session', filterKey: 'waiting_approval' });
  });
});
