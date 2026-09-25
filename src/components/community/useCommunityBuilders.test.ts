import { describe, expect, it } from 'vitest';
import {
  builderContributionCount,
  rankCommunityBuilders,
  type BuilderCommentRow,
  type BuilderPostRow,
  type BuilderReactionRow,
} from '../../lib/communityBuilders';
import type { CommunityBuilderMember } from './useCommunityBuilders';

/** Mid-month HCM: 2026-09-15 12:00 +07 */
const NOW_MS = Date.parse('2026-09-15T05:00:00.000Z');
const MONTH_START = '2026-09-01T00:00:00+07:00';

/**
 * Mirrors the hook join: ranked candidates → approved profiles → member shape.
 * Ensures contributionCount is the raw sum and score never lands on the member.
 */
function joinMembers(
  posts: BuilderPostRow[],
  comments: BuilderCommentRow[],
  reactions: BuilderReactionRow[],
  profiles: Array<{ userId: string; displayName: string; approvalStatus: string }>,
): CommunityBuilderMember[] {
  const ranked = rankCommunityBuilders(posts, comments, reactions, {
    monthStartIso: MONTH_START,
    nowMs: NOW_MS,
  });
  const approved = new Map(
    profiles
      .filter((p) => p.approvalStatus === 'approved')
      .map((p) => [p.userId, p]),
  );
  const out: CommunityBuilderMember[] = [];
  for (const candidate of ranked) {
    if (out.length >= 5) break;
    const profile = approved.get(candidate.userId);
    if (!profile) continue;
    out.push({
      userId: candidate.userId,
      displayName: profile.displayName,
      postCount: candidate.postCount,
      commentCount: candidate.commentCount,
      supportCount: candidate.supportCount,
      contributionCount: builderContributionCount(candidate),
    });
  }
  return out;
}

describe('useCommunityBuilders member join shape', () => {
  it('preserves ranking order and attaches raw contributionCount without score', () => {
    const members = joinMembers(
      [
        {
          id: 'p1',
          authorUserId: 'u-high',
          status: 'active',
          createdAt: '2026-09-10T00:00:00.000Z',
        },
        {
          id: 'p2',
          authorUserId: 'u-high',
          status: 'active',
          createdAt: '2026-09-11T00:00:00.000Z',
        },
        {
          id: 'p3',
          authorUserId: 'u-mid',
          status: 'active',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      [
        {
          id: 'c1',
          authorUserId: 'u-mid',
          status: 'active',
          createdAt: '2026-09-09T01:00:00.000Z',
        },
        {
          id: 'c2',
          authorUserId: 'u-mid',
          status: 'active',
          createdAt: '2026-09-09T02:00:00.000Z',
        },
        {
          id: 'c3',
          authorUserId: 'u-mid',
          status: 'active',
          createdAt: '2026-09-09T03:00:00.000Z',
        },
        {
          id: 'c4',
          authorUserId: 'u-mid',
          status: 'active',
          createdAt: '2026-09-09T04:00:00.000Z',
        },
      ],
      [
        {
          userId: 'u-high',
          postId: 'x1',
          commentId: '',
          createdAt: '2026-09-10T05:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x2',
          commentId: '',
          createdAt: '2026-09-10T06:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x3',
          commentId: '',
          createdAt: '2026-09-10T07:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x4',
          commentId: '',
          createdAt: '2026-09-10T08:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x5',
          commentId: '',
          createdAt: '2026-09-10T09:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x6',
          commentId: '',
          createdAt: '2026-09-10T10:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x7',
          commentId: '',
          createdAt: '2026-09-10T11:00:00.000Z',
        },
        {
          userId: 'u-high',
          postId: 'x8',
          commentId: '',
          createdAt: '2026-09-10T12:00:00.000Z',
        },
      ],
      [
        { userId: 'u-high', displayName: 'High', approvalStatus: 'approved' },
        { userId: 'u-mid', displayName: 'Mid', approvalStatus: 'approved' },
      ],
    );

    // u-high: 2 posts + 0 comments + 8 support = score 6+8=14, contribution 10
    // u-mid: 1 post + 4 comments + 0 support = score 3+8=11, contribution 5
    expect(members.map((m) => m.userId)).toEqual(['u-high', 'u-mid']);
    expect(members[0]).toMatchObject({
      postCount: 2,
      commentCount: 0,
      supportCount: 8,
      contributionCount: 10,
    });
    expect(members[1]).toMatchObject({
      postCount: 1,
      commentCount: 4,
      supportCount: 0,
      contributionCount: 5,
    });
    expect(members[0]).not.toHaveProperty('score');
    expect(members[1]).not.toHaveProperty('score');
  });

  it('sets contributionCount = postCount + commentCount + supportCount', () => {
    const members = joinMembers(
      [
        {
          id: 'a',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T03:00:00.000Z',
        },
        {
          id: 'b',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T03:30:00.000Z',
        },
        {
          id: 'c',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T03:45:00.000Z',
        },
      ],
      [
        {
          id: 'c1',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T04:00:00.000Z',
        },
        {
          id: 'c2',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T04:10:00.000Z',
        },
        {
          id: 'c3',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T04:20:00.000Z',
        },
        {
          id: 'c4',
          authorUserId: 'u1',
          status: 'active',
          createdAt: '2026-09-10T04:30:00.000Z',
        },
      ],
      Array.from({ length: 8 }, (_, i) => ({
        userId: 'u1',
        postId: `p${i}`,
        commentId: '',
        createdAt: `2026-09-10T05:${String(i).padStart(2, '0')}:00.000Z`,
      })),
      [{ userId: 'u1', displayName: 'Ann', approvalStatus: 'approved' }],
    );

    expect(members).toHaveLength(1);
    expect(members[0].contributionCount).toBe(
      members[0].postCount + members[0].commentCount + members[0].supportCount,
    );
    expect(members[0].contributionCount).toBe(15);
  });
});
