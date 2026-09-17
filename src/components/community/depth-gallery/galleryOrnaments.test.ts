import { describe, expect, it } from 'vitest';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import {
  COMMENT_ANGLE_MAX,
  COMMENT_ANGLE_MIN,
  COMMENT_AUTHOR_GAP_MAX,
  COMMENT_AUTHOR_GAP_MIN,
  COMMENT_RADIUS_MAX,
  COMMENT_RADIUS_MIN,
  GALLERY_COMMENT_REACTION_BADGE_CAP,
  GALLERY_ORNAMENT_COMMENT_CAP,
  GALLERY_ORNAMENT_REACTION_CAP,
  INNER_RADIUS_MAX,
  INNER_RADIUS_MIN,
  REACTION_ANGLE_MAX,
  REACTION_ANGLE_MIN,
  REACTION_RADIUS_MAX,
  REACTION_RADIUS_MIN,
  buildGalleryOrnamentLayout,
  hashOrnamentUnit,
  ornamentOpacity,
  ornamentRevealForIndex,
  polarPercent,
  selectGalleryComments,
  selectGalleryReactions,
  selectCommentReactionBadges,
  settleReveal,
  spaceArcAngles,
  spaceCommentRestAngles,
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

  it('stores the full author and comment body on ornament slots', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz 1234567890 plus extra words that go well past forty eight characters';
    const layout = buildGalleryOrnamentLayout({
      post: post({ body: long }),
      reactions: [],
      comments: [comment({ id: 'c-long', body: long, createdAt: '2026-09-08T00:00:00.000Z' })],
      reactorProfiles: new Map(),
    });
    expect(layout.author.body).toBe(long);
    expect(layout.comments[0]?.body).toBe(long);
    expect(layout.author.body.length).toBeGreaterThan(48);
    expect(layout.comments[0]?.body.length).toBeGreaterThan(48);
  });

  it('shows a GIF-content thumb on GIF-only and text+GIF pills, never on the post arc', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [
        reaction({
          id: 'post-rxn',
          createdAt: '2026-09-01T00:00:00.000Z',
          reactionType: 'giphy',
          unicode: '',
          giphyId: 'rxn-gif',
          giphyUrl: 'https://media.giphy.com/media/rxn-gif/200.gif',
        }),
      ],
      comments: [
        comment({
          id: 'gif-only',
          body: '',
          createdAt: '2026-09-08T00:00:00.000Z',
          giphyId: 'body-gif',
          giphyUrl: 'https://media.giphy.com/media/body-gif/200.gif',
          giphyPreviewUrl: 'https://media.giphy.com/media/body-gif/100.gif',
        }),
        comment({
          id: 'text-gif',
          body: 'caption with gif',
          createdAt: '2026-09-07T00:00:00.000Z',
          giphyId: 'body-gif-2',
          giphyUrl: 'https://media.giphy.com/media/body-gif-2/200.gif',
        }),
      ],
      reactorProfiles: new Map(),
    });
    const gifOnly = layout.comments.find((row) => row.id === 'gif-only');
    const textGif = layout.comments.find((row) => row.id === 'text-gif');
    expect(gifOnly?.body).toBe('');
    expect(gifOnly?.contentGiphyUrl).toBe('https://media.giphy.com/media/body-gif/100.gif');
    expect(textGif?.body).toBe('caption with gif');
    expect(textGif?.contentGiphyUrl).toBe('https://media.giphy.com/media/body-gif-2/200.gif');
    expect(layout.reactions.some((row) => row.id === 'post-rxn')).toBe(true);
    expect(layout.reactions.some((row) => row.giphyUrl.includes('body-gif'))).toBe(false);
    expect(layout.comments).toHaveLength(2);
  });

  it('shows a photo-content thumb on comment pills, never on the post arc', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [],
      comments: [
        comment({
          id: 'photo-only',
          body: '',
          createdAt: '2026-09-08T00:00:00.000Z',
          attachmentKind: 'image',
          attachmentPath: 'stores/community/post-a/c.jpg',
          attachmentUrl: 'https://example.com/c.jpg',
        }),
      ],
      reactorProfiles: new Map(),
    });
    expect(layout.comments[0]?.contentPhotoUrl).toBe('https://example.com/c.jpg');
    expect(layout.comments[0]?.contentGiphyUrl).toBe('');
  });

  it('attaches 1–3 comment-scoped badges by count then recency, not post or reply reactions', () => {
    const comments = [
      comment({ id: 'c-pill', createdAt: '2026-09-08T00:00:00.000Z' }),
      comment({
        id: 'c-reply',
        parentId: 'c-pill',
        createdAt: '2026-09-09T00:00:00.000Z',
      }),
    ];
    const reactions = [
      reaction({ id: 'post-arc', unicode: '😮', createdAt: '2026-09-10T00:00:00.000Z' }),
      reaction({
        id: 'heart-1',
        commentId: 'c-pill',
        unicode: '❤️',
        userId: 'u1',
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
      reaction({
        id: 'heart-2',
        commentId: 'c-pill',
        unicode: '❤️',
        userId: 'u2',
        createdAt: '2026-09-04T00:00:00.000Z',
      }),
      reaction({
        id: 'laugh',
        commentId: 'c-pill',
        unicode: '😂',
        createdAt: '2026-09-05T00:00:00.000Z',
      }),
      reaction({
        id: 'pray',
        commentId: 'c-pill',
        unicode: '🙏',
        createdAt: '2026-09-06T00:00:00.000Z',
      }),
      reaction({
        id: 'fire',
        commentId: 'c-pill',
        unicode: '🔥',
        createdAt: '2026-09-07T00:00:00.000Z',
      }),
      reaction({
        id: 'reply-only',
        commentId: 'c-reply',
        unicode: '👍',
        createdAt: '2026-09-08T00:00:00.000Z',
      }),
    ];
    const badges = selectCommentReactionBadges(reactions, 'post-a', 'c-pill');
    expect(badges).toHaveLength(GALLERY_COMMENT_REACTION_BADGE_CAP);
    expect(badges.map((row) => row.unicode)).toEqual(['❤️', '🔥', '🙏']);

    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions,
      comments,
      reactorProfiles: new Map(),
    });
    expect(layout.comments).toHaveLength(1);
    expect(layout.comments[0].id).toBe('c-pill');
    expect(layout.comments[0].reactionBadges.map((row) => row.unicode)).toEqual(['❤️', '🔥', '🙏']);
    expect(layout.reactions.map((row) => row.id)).toEqual(['post-arc']);
    expect(layout.reactions.some((row) => row.unicode === '❤️')).toBe(false);
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

  it('multiplies plane and reveal by (1 - vanishAmount)', () => {
    expect(ornamentOpacity(1, 1, 0)).toBe(1);
    expect(ornamentOpacity(1, 1, 1)).toBe(0);
    expect(ornamentOpacity(1, 1, 0.5)).toBe(0.5);
    expect(ornamentOpacity(1, 1)).toBe(1);
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

describe('even rest spacing', () => {
  it('places slice midpoints on an arc', () => {
    expect(spaceArcAngles(0, 200, 340)).toEqual([]);
    expect(spaceArcAngles(1, 200, 340)[0]).toBeCloseTo(270, 8);
    expect(spaceArcAngles(2, 0, 10)[0]).toBeCloseTo(2.5, 8);
    expect(spaceArcAngles(2, 0, 10)[1]).toBeCloseTo(7.5, 8);
  });

  it('gives 8 reactions even rest-angle gaps on the upper arc', () => {
    const reactions = Array.from({ length: 8 }, (_, i) =>
      reaction({
        id: `r${i}`,
        createdAt: `2026-09-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions,
      comments: [],
      reactorProfiles: new Map(),
    });
    expect(layout.reactions).toHaveLength(GALLERY_ORNAMENT_REACTION_CAP);
    const expected = spaceArcAngles(
      GALLERY_ORNAMENT_REACTION_CAP,
      REACTION_ANGLE_MIN,
      REACTION_ANGLE_MAX,
    );
    expect(layout.reactions.map((row) => row.angleDeg)).toEqual(expected);
    const gaps = expected.slice(1).map((angle, i) => angle - expected[i]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 8);
    }
    for (const row of layout.reactions) {
      expect(row.angleDeg).toBeGreaterThanOrEqual(REACTION_ANGLE_MIN);
      expect(row.angleDeg).toBeLessThanOrEqual(REACTION_ANGLE_MAX);
      expect(row.radiusPct).toBeGreaterThanOrEqual(REACTION_RADIUS_MIN);
      expect(row.radiusPct).toBeLessThanOrEqual(REACTION_RADIUS_MAX);
      expect(row.innerRadiusPct).toBeGreaterThanOrEqual(INNER_RADIUS_MIN);
      expect(row.innerRadiusPct).toBeLessThanOrEqual(INNER_RADIUS_MAX);
      const inner = polarPercent(row.angleDeg, row.innerRadiusPct);
      expect(row.innerLeftPct).toBeCloseTo(inner.leftPct, 8);
      expect(row.innerTopPct).toBeCloseTo(inner.topPct, 8);
    }
  });

  it('keeps inner radii hashed in 12–28 and rest/inner on the same angle', () => {
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [
        reaction({ id: 'r1', createdAt: '2026-09-01T00:00:00.000Z' }),
        reaction({ id: 'r2', createdAt: '2026-09-02T00:00:00.000Z' }),
      ],
      comments: [
        comment({ id: 'c1', createdAt: '2026-09-03T00:00:00.000Z' }),
        comment({ id: 'c2', createdAt: '2026-09-04T00:00:00.000Z' }),
      ],
      reactorProfiles: new Map(),
    });
    for (const row of [...layout.reactions, ...layout.comments]) {
      expect(row.innerRadiusPct).toBeGreaterThanOrEqual(INNER_RADIUS_MIN);
      expect(row.innerRadiusPct).toBeLessThanOrEqual(INNER_RADIUS_MAX);
      const rest = polarPercent(row.angleDeg, row.radiusPct);
      const inner = polarPercent(row.angleDeg, row.innerRadiusPct);
      expect(row.leftPct).toBeCloseTo(rest.leftPct, 8);
      expect(row.topPct).toBeCloseTo(rest.topPct, 8);
      expect(row.innerLeftPct).toBeCloseTo(inner.leftPct, 8);
      expect(row.innerTopPct).toBeCloseTo(inner.topPct, 8);
    }
  });

  it('spaces comments around the author gap and fills by sorted id', () => {
    const comments = Array.from({ length: 6 }, (_, i) =>
      comment({
        id: `c${i}`,
        createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
      }),
    );
    const layout = buildGalleryOrnamentLayout({
      post: post(),
      reactions: [],
      comments,
      reactorProfiles: new Map(),
    });
    expect(layout.comments).toHaveLength(GALLERY_ORNAMENT_COMMENT_CAP);
    const expectedById = spaceCommentRestAngles(GALLERY_ORNAMENT_COMMENT_CAP);
    const sortedIds = [...layout.comments].map((row) => row.id).sort((a, b) => a.localeCompare(b));
    const angleById = Object.fromEntries(layout.comments.map((row) => [row.id, row.angleDeg]));
    sortedIds.forEach((id, i) => {
      expect(angleById[id]).toBeCloseTo(expectedById[i], 8);
    });
    for (const row of layout.comments) {
      const inLeft = row.angleDeg >= COMMENT_ANGLE_MIN && row.angleDeg <= COMMENT_AUTHOR_GAP_MIN;
      const inRight = row.angleDeg >= COMMENT_AUTHOR_GAP_MAX && row.angleDeg <= COMMENT_ANGLE_MAX;
      expect(inLeft || inRight).toBe(true);
      expect(row.angleDeg > COMMENT_AUTHOR_GAP_MIN && row.angleDeg < COMMENT_AUTHOR_GAP_MAX).toBe(
        false,
      );
      expect(row.radiusPct).toBeGreaterThanOrEqual(COMMENT_RADIUS_MIN);
      expect(row.radiusPct).toBeLessThanOrEqual(COMMENT_RADIUS_MAX);
      expect(row.innerRadiusPct).toBeGreaterThanOrEqual(INNER_RADIUS_MIN);
      expect(row.innerRadiusPct).toBeLessThanOrEqual(INNER_RADIUS_MAX);
    }
  });

  it('keeps rest layout stable for the same ids', () => {
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
      reactions: [...reactions].reverse(),
      comments: [...comments].reverse(),
      reactorProfiles: new Map(),
    });
    expect(a.reactions.map((row) => [row.id, row.angleDeg, row.radiusPct, row.innerRadiusPct])).toEqual(
      b.reactions.map((row) => [row.id, row.angleDeg, row.radiusPct, row.innerRadiusPct]),
    );
    expect(a.comments.map((row) => [row.id, row.angleDeg, row.radiusPct, row.innerRadiusPct])).toEqual(
      b.comments.map((row) => [row.id, row.angleDeg, row.radiusPct, row.innerRadiusPct]),
    );
  });
});
