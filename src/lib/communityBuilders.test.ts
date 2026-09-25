import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_BUILDER_COMMENT_WEIGHT,
  COMMUNITY_BUILDER_POST_WEIGHT,
  COMMUNITY_BUILDER_SUPPORT_WEIGHT,
  COMMUNITY_BUILDERS_LIMIT,
  COMMUNITY_BUILDERS_TIMEZONE,
  communityBuildersMonthStartIso,
  rankCommunityBuilders,
  selectCommunityBuilders,
  supportDedupeKey,
  type BuilderCommentRow,
  type BuilderPostRow,
  type BuilderReactionRow,
} from './communityBuilders';

/** Mid-month HCM: 2026-09-15 12:00 +07 = 2026-09-15T05:00:00.000Z */
const NOW_MS = Date.parse('2026-09-15T05:00:00.000Z');
const MONTH_START = '2026-09-01T00:00:00+07:00';

function post(
  partial: Partial<BuilderPostRow> & Pick<BuilderPostRow, 'id' | 'authorUserId'>,
): BuilderPostRow {
  return {
    status: 'active',
    createdAt: '2026-09-10T03:00:00.000Z',
    ...partial,
  };
}

function comment(
  partial: Partial<BuilderCommentRow> & Pick<BuilderCommentRow, 'id' | 'authorUserId'>,
): BuilderCommentRow {
  return {
    status: 'active',
    createdAt: '2026-09-10T04:00:00.000Z',
    ...partial,
  };
}

function reaction(
  partial: Partial<BuilderReactionRow> & Pick<BuilderReactionRow, 'userId' | 'postId'>,
): BuilderReactionRow {
  return {
    commentId: '',
    createdAt: '2026-09-10T05:00:00.000Z',
    ...partial,
  };
}

const selectOpts = { monthStartIso: MONTH_START, nowMs: NOW_MS };

describe('communityBuilders constants', () => {
  it('uses Share=3, Connect=2, Support=1, limit 5, HCM timezone', () => {
    expect(COMMUNITY_BUILDER_POST_WEIGHT).toBe(3);
    expect(COMMUNITY_BUILDER_COMMENT_WEIGHT).toBe(2);
    expect(COMMUNITY_BUILDER_SUPPORT_WEIGHT).toBe(1);
    expect(COMMUNITY_BUILDERS_LIMIT).toBe(5);
    expect(COMMUNITY_BUILDERS_TIMEZONE).toBe('Asia/Ho_Chi_Minh');
  });
});

describe('communityBuildersMonthStartIso', () => {
  it('returns first instant of the HCM calendar month', () => {
    expect(communityBuildersMonthStartIso(NOW_MS)).toBe('2026-09-01T00:00:00+07:00');
  });

  it('uses HCM date near UTC midnight at month edge', () => {
    // 2026-08-31 22:00 UTC = 2026-09-01 05:00 HCM → September
    expect(communityBuildersMonthStartIso(Date.parse('2026-08-31T22:00:00.000Z'))).toBe(
      '2026-09-01T00:00:00+07:00',
    );
    // 2026-08-31 16:00 UTC = 2026-08-31 23:00 HCM → still August
    expect(communityBuildersMonthStartIso(Date.parse('2026-08-31T16:00:00.000Z'))).toBe(
      '2026-08-01T00:00:00+07:00',
    );
  });
});

describe('supportDedupeKey', () => {
  it('keys post reactions with empty commentId', () => {
    expect(supportDedupeKey({ userId: 'u1', postId: 'p1', commentId: '' })).toBe('u1:p1:');
    expect(supportDedupeKey({ userId: 'u1', postId: 'p1', commentId: '  ' })).toBe('u1:p1:');
  });

  it('keys comment reactions independently', () => {
    expect(supportDedupeKey({ userId: 'u1', postId: 'p1', commentId: 'c1' })).toBe('u1:p1:c1');
  });
});

describe('selectCommunityBuilders scoring', () => {
  it('scores posts×3 + comments×2 + uniqueSupport×1', () => {
    const ranked = rankCommunityBuilders(
      [post({ id: 'a', authorUserId: 'u1' }), post({ id: 'b', authorUserId: 'u1' })],
      [comment({ id: 'c1', authorUserId: 'u1' })],
      [
        reaction({ userId: 'u1', postId: 'p1' }),
        reaction({ userId: 'u1', postId: 'p1', commentId: 'c9' }),
      ],
      selectOpts,
    );
    expect(ranked[0]).toMatchObject({
      userId: 'u1',
      postCount: 2,
      commentCount: 1,
      supportCount: 2,
      score: 2 * 3 + 1 * 2 + 2 * 1,
    });
  });

  it('dedupes three emojis on the same post target to one Support', () => {
    const ranked = rankCommunityBuilders(
      [],
      [],
      [
        reaction({ userId: 'u1', postId: 'p1', createdAt: '2026-09-10T05:00:00.000Z' }),
        reaction({ userId: 'u1', postId: 'p1', createdAt: '2026-09-10T06:00:00.000Z' }),
        reaction({ userId: 'u1', postId: 'p1', createdAt: '2026-09-10T07:00:00.000Z' }),
      ],
      selectOpts,
    );
    expect(ranked[0]?.supportCount).toBe(1);
    expect(ranked[0]?.score).toBe(1);
  });

  it('counts separate Support targets independently', () => {
    const ranked = rankCommunityBuilders(
      [],
      [],
      [
        reaction({ userId: 'u1', postId: 'p1', commentId: '' }),
        reaction({ userId: 'u1', postId: 'p1', commentId: 'c1' }),
        reaction({ userId: 'u1', postId: 'p2', commentId: '' }),
      ],
      selectOpts,
    );
    expect(ranked[0]?.supportCount).toBe(3);
    expect(ranked[0]?.score).toBe(3);
  });
});

describe('selectCommunityBuilders filters', () => {
  it('excludes non-active posts and comments', () => {
    const ids = selectCommunityBuilders(
      [
        post({ id: 'h', authorUserId: 'u1', status: 'hidden' }),
        post({ id: 'd', authorUserId: 'u2', status: 'deleted' }),
        post({ id: 'a', authorUserId: 'u3', status: 'active' }),
      ],
      [
        comment({ id: 'ch', authorUserId: 'u1', status: 'hidden' }),
        comment({ id: 'ca', authorUserId: 'u4', status: 'active' }),
      ],
      [],
      selectOpts,
    );
    expect(ids).toEqual(['u3', 'u4']);
  });

  it('excludes prior-month contributions', () => {
    const ids = selectCommunityBuilders(
      [
        post({
          id: 'old',
          authorUserId: 'u1',
          createdAt: '2026-08-31T16:00:00.000Z', // Aug 31 23:00 HCM
        }),
        post({
          id: 'ok',
          authorUserId: 'u2',
          createdAt: '2026-08-31T17:00:00.000Z', // Sep 1 00:00 HCM
        }),
      ],
      [],
      [],
      selectOpts,
    );
    expect(ids).toEqual(['u2']);
  });

  it('excludes future-dated rows past now', () => {
    const ids = selectCommunityBuilders(
      [
        post({
          id: 'future',
          authorUserId: 'u1',
          createdAt: '2026-09-20T00:00:00.000Z',
        }),
      ],
      [],
      [],
      selectOpts,
    );
    expect(ids).toEqual([]);
  });
});

describe('selectCommunityBuilders ordering and limit', () => {
  it('orders by score, then categories, then lastContributionAt, then userId', () => {
    // u-tie-a and u-tie-b: same score (3), same categories (1), different last → newer first
    // u-cats: score 3 but 2 categories (post+support) → wins over single-category score 3
    // u-high: score 6
    const ids = selectCommunityBuilders(
      [
        post({
          id: 'p-high',
          authorUserId: 'u-high',
          createdAt: '2026-09-05T00:00:00.000Z',
        }),
        post({
          id: 'p-high-2',
          authorUserId: 'u-high',
          createdAt: '2026-09-06T00:00:00.000Z',
        }),
        post({
          id: 'p-cats',
          authorUserId: 'u-cats',
          createdAt: '2026-09-04T00:00:00.000Z',
        }),
        post({
          id: 'p-tie-a',
          authorUserId: 'u-tie-a',
          createdAt: '2026-09-03T00:00:00.000Z',
        }),
        post({
          id: 'p-tie-b',
          authorUserId: 'u-tie-b',
          createdAt: '2026-09-08T00:00:00.000Z',
        }),
        post({
          id: 'p-id',
          authorUserId: 'aaa',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
        post({
          id: 'p-id-2',
          authorUserId: 'zzz',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ],
      [],
      [reaction({ userId: 'u-cats', postId: 'p-cats', createdAt: '2026-09-04T01:00:00.000Z' })],
      selectOpts,
    );
    // u-high: 6; u-cats: 3+1=4; then score-3 ties: u-tie-b (newer), u-tie-a, aaa, zzz by id among equal last
    expect(ids.slice(0, 4)).toEqual(['u-high', 'u-cats', 'u-tie-b', 'u-tie-a']);
    expect(ids.slice(4)).toEqual(['aaa']); // limit 5
    expect(ids).not.toContain('zzz');
  });

  it('caps at COMMUNITY_BUILDERS_LIMIT', () => {
    const posts = Array.from({ length: 8 }, (_, i) =>
      post({
        id: `p${i}`,
        authorUserId: `u${i}`,
        createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const ids = selectCommunityBuilders(posts, [], [], selectOpts);
    expect(ids).toHaveLength(5);
  });

  it('skips ineligible userIds and fills from next ranked', () => {
    const posts = [
      post({ id: 'p1', authorUserId: 'top', createdAt: '2026-09-12T00:00:00.000Z' }),
      post({ id: 'p2', authorUserId: 'top', createdAt: '2026-09-13T00:00:00.000Z' }),
      post({ id: 'p3', authorUserId: 'mid', createdAt: '2026-09-11T00:00:00.000Z' }),
      post({ id: 'p4', authorUserId: 'low', createdAt: '2026-09-10T00:00:00.000Z' }),
    ];
    const ids = selectCommunityBuilders(posts, [], [], {
      ...selectOpts,
      eligibleUserIds: new Set(['mid', 'low']),
      limit: 2,
    });
    expect(ids).toEqual(['mid', 'low']);
  });

  it('returns empty when nothing scores', () => {
    expect(selectCommunityBuilders([], [], [], selectOpts)).toEqual([]);
  });
});
