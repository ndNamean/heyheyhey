import { describe, expect, it } from 'vitest';
import {
  OPEN_REVIEW_REPORT_EVENT,
  buildReportDeepLinkUrl,
  ensureReportDeepLinkJson,
  parseReportDeepLinkFromSearch,
  parseReportDeepLinkJson,
  resolveStoreChatReportDeepLink,
  serializeReportDeepLink,
} from './reportDeepLink';

describe('reportDeepLink', () => {
  it('exposes open review event name', () => {
    expect(OPEN_REVIEW_REPORT_EVENT).toBe('heyPelo:openReviewReport');
  });

  it('builds and parses search deep links', () => {
    const url = buildReportDeepLinkUrl({ reportId: 'r1', storeId: 's1' });
    expect(url).toContain('open=review');
    expect(url).toContain('reportId=r1');
    expect(url).toContain('surface=reports');
    const parsed = parseReportDeepLinkFromSearch(url.replace('/?', '?'));
    expect(parsed).toEqual({
      page: 'review',
      surface: 'reports',
      reportId: 'r1',
      storeId: 's1',
    });
  });

  it('serializes and parses json', () => {
    const raw = serializeReportDeepLink({ reportId: 'r9', storeId: 's9' });
    expect(parseReportDeepLinkJson(raw)).toEqual({
      page: 'review',
      surface: 'reports',
      reportId: 'r9',
      storeId: 's9',
    });
  });

  it('resolves from message deepLinkJson or reportId fallback', () => {
    expect(
      resolveStoreChatReportDeepLink({
        deepLinkJson: serializeReportDeepLink({ reportId: 'r2', storeId: 's2' }),
      }),
    ).toEqual({
      page: 'review',
      surface: 'reports',
      reportId: 'r2',
      storeId: 's2',
    });
    expect(
      resolveStoreChatReportDeepLink({
        reportId: 'r3',
        storeId: 's3',
      }),
    ).toEqual({
      page: 'review',
      surface: 'reports',
      reportId: 'r3',
      storeId: 's3',
    });
  });

  it('ensureReportDeepLinkJson fills missing json', () => {
    const json = ensureReportDeepLinkJson({ reportId: 'r4', storeId: 's4' });
    expect(JSON.parse(json).reportId).toBe('r4');
  });
});
