import { describe, expect, it } from 'vitest';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import {
  COMMENT_ANGLE_MAX,
  COMMENT_ANGLE_MIN,
  GALLERY_ORNAMENT_COMMENT_CAP,
  GALLERY_ORNAMENT_REACTION_CAP,
  REACTION_ANGLE_MAX,
  REACTION_ANGLE_MIN,
  buildGalleryOrnamentLayout,
  hashOrnamentUnit,
  ornamentRevealForIndex,
  polarPercent,
  selectGalleryComments,
  selectGalleryReactions,
  settleReveal,
  truncateOrnamentText,
} from './galleryOrnaments';

function reaction(
  extra: Partial<CommunityReaction> & Pick<CommunityReaction, 'id' | 'createdAt'>,
): CommunityReaction {
  return {
    postId: 'post-a',
    userId: extra.userId || extra.id,
    commentId: '',
    reactionType: 'unicode',
    unicode: '❤️',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    clientMutationId: extra.id,
    ...extra,
  };
}

function comment(
  extra: Partial<CommunityComment> & Pick<CommunityComment, 'id' | 'createdAt'>,
): CommunityComment {
  return {
    postId: 'post-a',
    parentId: '',
    authorUserId: extra.authorUserId || extra.id,
    authorProfileId: 'p',
    authorNameSnapshot: extra.authorNameSnapshot || extra.id,
    authorRoleSnapshot: '',
    body: extra.body || `body ${extra.id}`,
    status: 'active',
    deletedAt: '',
    ...extra,
  };
}

function post(extra: Partial<CommunityPost> = {}): Pick<
  CommunityPost,
  'id' | 'body' | 'authorUserId' | 'authorNameSnapshot' | 'author'
> {
  return {
    id: 'post-a',
    body: 'Hello gallery',
    authorUserId: 'author-1',
    authorNameSnapshot: 'Giathy',
    ...extra,
  };
}

describe('hashed scatter', () => {
  it('is stable for the same ids', () => {
    const reactions = [
      reaction({ id: 'r1', createdAt: '2026-09-01T00:00:00.000Z' }),
      reaction({ id: 'r2', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const comments = [
      comment({ id: 'c1', createdAt: '2026-09-03T00:00:00.000Z' }),
      comment({ id: 'c2', createdAt: '2026-09-04T00:00:00.000Z' }),
    ];
    const a = buildGalleryOrnamentLayout({
      post: post(),
      reactions,
      comments,
      reactorProfiles: new Map(),
    });
    const b = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [...reactions],
      comments: [...comments],
      reactorProfiles: new Map(),
    });
    expect(a.reactions.map((row) => [row.id, row.angleDeg, row.radiusPct])).toEqual(
      b.reactions.map((row) => [row.id, row.angleDeg, row.radiusPct]),
    );
    expect(a.comments.map((row) => [row.id, row.angleDeg, row.radiusPct])).toEqual(
      b.comments.map((row) => [row.id, row.angleDeg, row.radiusPct]),
    );
    expect(hashOrnamentUnit('post-a', 'r1')).toBe(hashOrnamentUnit('post-a', 'r1'));
  });

  it('keeps slot angles when reaction/comment order is reversed (reverse scroll)', () => {
    const reactions = [
      reaction({ id: 'r1', createdAt: '2026-09-01T00:00:00.000Z' }),
      reaction({ id: 'r2', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const comments = [
      comment({ id: 'c-old', createdAt: '2026-09-01T00:00:00.000Z' }),
      comment({ id: 'c-new', createdAt: '2026-09-08T00:00:00.000Z' }),
    ];
    const forward = buildGalleryOrnamentLayout({
      post: post(),
      reactions,
      comments,
      reactorProfiles: new Map(),
    });
    const reverse = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [...reactions].reverse(),
      comments: [...comments].reverse(),
      reactorProfiles: new Map(),
    });
    const angleById = (rows: Array<{ id: string; angleDeg: number }>) =>
      Object.fromEntries(rows.map((row) => [row.id, row.angleDeg]));
    expect(angleById(reverse.reactions)).toEqual(angleById(forward.reactions));
    expect(angleById(reverse.comments)).toEqual(angleById(forward.comments));
  });

  it('places reactions in the upper arc and comments in the lower band', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [reaction({ id: 'r1', createdAt: '2026-09-01T00:00:00.000Z' })],
      comments: [comment({ id: 'c1', createdAt: '2026-09-08T00:00:00.000Z' })],
      reactorProfiles: new Map(),
    });
    expect(layout.reactions[0].angleDeg).toBeGreaterThanOrEqual(REACTION_ANGLE_MIN);
    expect(layout.reactions[0].angleDeg).toBeLessThanOrEqual(REACTION_ANGLE_MAX);
    expect(layout.comments[0].angleDeg).toBeGreaterThanOrEqual(COMMENT_ANGLE_MIN);
    expect(layout.comments[0].angleDeg).toBeLessThanOrEqual(COMMENT_ANGLE_MAX);
  });

  it('maps 270° to the top of the stack (clockwise from east, y-down)', () => {
    const top = polarPercent(270, 50);
    expect(top.leftPct).toBeCloseTo(50, 8);
    expect(top.topPct).toBeCloseTo(0, 8);
    const bottom = polarPercent(90, 50);
    expect(bottom.leftPct).toBeCloseTo(50, 8);
    expect(bottom.topPct).toBeCloseTo(100, 8);
  });
});

describe('caps and filters', () => {
  it('keeps the oldest 8 post reactions and skips comment-thread reactions', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      reaction({
        id: `r${i}`,
        createdAt: `2026-09-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    rows.push(
      reaction({
        id: 'on-comment',
        createdAt: '2026-08-01T00:00:00.000Z',
        commentId: 'c1',
      }),
    );
    rows.push(
      reaction({
        id: 'other-post',
        postId: 'post-b',
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
    );
    const selected = selectGalleryReactions(rows, 'post-a');
    expect(selected).toHaveLength(GALLERY_ORNAMENT_REACTION_CAP);
    expect(selected.map((row) => row.id)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
      'r7',
    ]);
    expect(selected.some((row) => row.id === 'on-comment')).toBe(false);
  });

  it('keeps the newest 6 top-level active comments', () => {
    const rows = [
      comment({ id: 'reply', parentId: 'c0', createdAt: '2026-09-09T12:00:00.000Z' }),
      comment({ id: 'hidden', status: 'hidden', createdAt: '2026-09-09T12:00:00.000Z' }),
      comment({ id: 'deleted', status: 'deleted', createdAt: '2026-09-09T12:00:00.000Z' }),
      ...Array.from({ length: 8 }, (_, i) =>
        comment({
          id: `c${i}`,
          createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
        }),
      ),
    ];
    const selected = selectGalleryComments(rows, 'post-a');
    expect(selected).toHaveLength(GALLERY_ORNAMENT_COMMENT_CAP);
    expect(selected.map((row) => row.id)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3', 'c2']);
  });

  it('always includes the author even when reactions and comments are empty', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post({ body: 'A title that should be kept' }),
      reactions: [],
      comments: [],
      reactorProfiles: new Map(),
    });
    expect(layout.reactions).toEqual([]);
    expect(layout.comments).toEqual([]);
    expect(layout.author.name).toBe('Giathy');
    expect(layout.author.body).toBe('A title that should be kept');
  });

  it('truncates comment bodies around 48 characters', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz 1234567890 plus extra words';
    expect(truncateOrnamentText(long)).toHaveLength(48);
    expect(truncateOrnamentText(long).endsWith('…')).toBe(true);
  });
});

describe('settleReveal', () => {
  it('shows the current plane at blend 0 and the next plane at blend 1', () => {
    expect(settleReveal(0, 'current')).toBeCloseTo(1, 8);
    expect(settleReveal(0, 'next')).toBeCloseTo(0, 8);
    expect(settleReveal(0, 'other')).toBe(0);

    expect(settleReveal(1, 'current')).toBeCloseTo(0, 8);
    expect(settleReveal(1, 'next')).toBeCloseTo(1, 8);
    expect(settleReveal(1, 'other')).toBe(0);
  });

  it('keeps both current and next low at mid-blend', () => {
    expect(settleReveal(0.5, 'current')).toBeCloseTo(0, 8);
    expect(settleReveal(0.5, 'next')).toBeCloseTo(0, 8);
    expect(ornamentRevealForIndex(0, 0, 1, 0.5)).toBeCloseTo(0, 8);
    expect(ornamentRevealForIndex(1, 0, 1, 0.5)).toBeCloseTo(0, 8);
    expect(ornamentRevealForIndex(2, 0, 1, 0)).toBe(0);
  });

  it('stays visible on the last plane when current and next share an index', () => {
    expect(ornamentRevealForIndex(4, 4, 4, 0)).toBeCloseTo(1, 8);
  });
});

describe('idle rest slots', () => {
  it('keeps rest polar slots unchanged when idle is 0', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [reaction({ id: 'r1', createdAt: '2026-09-01T00:00:00.000Z' })],
      comments: [comment({ id: 'c1', createdAt: '2026-09-08T00:00:00.000Z' })],
      reactorProfiles: new Map(),
    });
    const idle = 0;
    for (const row of [...layout.reactions, ...layout.comments]) {
      const rest = polarPercent(row.angleDeg, row.radiusPct);
      expect(row.leftPct).toBeCloseTo(rest.leftPct, 8);
      expect(row.topPct).toBeCloseTo(rest.topPct, 8);
      expect(row.leftPct + (row.innerLeftPct - row.leftPct) * idle).toBeCloseTo(row.leftPct, 8);
      expect(row.topPct + (row.innerTopPct - row.topPct) * idle).toBeCloseTo(row.topPct, 8);
      expect(row.innerRadiusPct).toBeLessThan(row.radiusPct);
    }
    expect(layout.reactions[0].angleDeg).toBeGreaterThanOrEqual(REACTION_ANGLE_MIN);
    expect(layout.reactions[0].angleDeg).toBeLessThanOrEqual(REACTION_ANGLE_MAX);
    expect(layout.comments[0].angleDeg).toBeGreaterThanOrEqual(COMMENT_ANGLE_MIN);
    expect(layout.comments[0].angleDeg).toBeLessThanOrEqual(COMMENT_ANGLE_MAX);
  });
});
