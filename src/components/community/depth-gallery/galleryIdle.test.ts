import { describe, expect, it } from 'vitest';
import {
  IDLE_CHIP_SCALE,
  IDLE_DWELL_MS,
  IDLE_LERP_DOWN,
  IDLE_LERP_UP,
  IDLE_VANISH_LERP_UP,
  IDLE_VANISH_START,
  ORNAMENT_SCROLL_REACTION_SCALE,
  ORNAMENT_SCROLL_TEXT_SCALE,
  composeIdleFrameScale,
  composeIdleImageScale,
  composeOrnamentScale,
  containRectForStack,
  coverScaleForStack,
  frameExpandScaleForOverlay,
  isGalleryScrollStill,
  resolveIdleImageSize,
  stepGalleryIdle,
  type GalleryIdleState,
} from './galleryIdle';
import {
  INNER_RADIUS_MAX,
  INNER_RADIUS_MIN,
  buildGalleryOrnamentLayout,
} from './galleryOrnaments';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';

function stillStep(
  state: GalleryIdleState,
  now: number,
  extra: Partial<Parameters<typeof stepGalleryIdle>[0]> = {},
): GalleryIdleState {
  return stepGalleryIdle({
    now,
    lastNow: state.lastNow,
    stillMs: state.stillMs,
    idleAmount: state.idleAmount,
    vanishAmount: state.vanishAmount,
    velocity: 0,
    scrollTarget: 10,
    scrollCurrent: 10,
    reducedMotion: false,
    ...extra,
  });
}

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

function post(): Pick<CommunityPost, 'id' | 'body' | 'authorUserId' | 'authorNameSnapshot' | 'author'> {
  return {
    id: 'post-a',
    body: 'Hello gallery',
    authorUserId: 'author-1',
    authorNameSnapshot: 'Giathy',
  };
}

describe('gallery idle amount', () => {
  it('treats low velocity and a small target gap as still', () => {
    expect(isGalleryScrollStill(0, 10, 10)).toBe(true);
    expect(isGalleryScrollStill(0.019, 10, 10.1)).toBe(true);
    expect(isGalleryScrollStill(0.03, 10, 10)).toBe(false);
    expect(isGalleryScrollStill(0, 10, 12)).toBe(false);
  });

  it('stays at 0 while still until the dwell elapses, then rises', () => {
    let state: GalleryIdleState = { lastNow: 0, stillMs: 0, idleAmount: 0, vanishAmount: 0 };
    state = stillStep(state, 16);
    expect(state.idleAmount).toBe(0);
    expect(state.vanishAmount).toBe(0);
    expect(state.stillMs).toBe(0);

    state = stillStep(state, 16 + (IDLE_DWELL_MS - 20));
    expect(state.stillMs).toBe(IDLE_DWELL_MS - 20);
    expect(state.idleAmount).toBe(0);

    state = stillStep(state, 16 + IDLE_DWELL_MS + 10);
    expect(state.stillMs).toBeGreaterThanOrEqual(IDLE_DWELL_MS);
    expect(state.idleAmount).toBeCloseTo(IDLE_LERP_UP, 8);
  });

  it('resets dwell and eases out when moving', () => {
    const down = stepGalleryIdle({
      now: 1000,
      lastNow: 984,
      stillMs: 400,
      idleAmount: 0.8,
      vanishAmount: 0.6,
      velocity: 0.4,
      scrollTarget: 40,
      scrollCurrent: 10,
      reducedMotion: false,
    });
    expect(down.stillMs).toBe(0);
    expect(down.idleAmount).toBeCloseTo(0.8 * (1 - IDLE_LERP_DOWN), 8);
    expect(down.vanishAmount).toBeCloseTo(0.6 * (1 - IDLE_LERP_DOWN), 8);
  });

  it('zooms out faster than it zooms in', () => {
    const afterDwell: GalleryIdleState = {
      lastNow: 500,
      stillMs: IDLE_DWELL_MS,
      idleAmount: 0,
      vanishAmount: 0,
    };
    const zoomIn = stillStep(afterDwell, 516);
    const zoomOut = stepGalleryIdle({
      now: 516,
      lastNow: 500,
      stillMs: IDLE_DWELL_MS,
      idleAmount: 1,
      vanishAmount: 1,
      velocity: 0.5,
      scrollTarget: 80,
      scrollCurrent: 10,
      reducedMotion: false,
    });
    expect(1 - zoomOut.idleAmount).toBeGreaterThan(zoomIn.idleAmount);
    expect(IDLE_LERP_DOWN).toBeGreaterThan(IDLE_LERP_UP);
  });

  it('stays at 0 under reduced motion even after a long still dwell', () => {
    let state: GalleryIdleState = { lastNow: 0, stillMs: 0, idleAmount: 0.9, vanishAmount: 0.8 };
    state = stillStep(state, 16, { reducedMotion: true });
    state = stillStep(state, 800, { reducedMotion: true });
    expect(state.idleAmount).toBe(0);
    expect(state.vanishAmount).toBe(0);
    expect(state.stillMs).toBe(0);
  });
});

describe('gallery idle vanish', () => {
  it('keeps vanish at 0 while idle walks in, then rises after 0.98', () => {
    let state: GalleryIdleState = {
      lastNow: 500,
      stillMs: IDLE_DWELL_MS,
      idleAmount: 0,
      vanishAmount: 0,
    };
    state = stillStep(state, 516);
    expect(state.idleAmount).toBeCloseTo(IDLE_LERP_UP, 8);
    expect(state.vanishAmount).toBe(0);

    state = stillStep(
      { lastNow: 516, stillMs: IDLE_DWELL_MS, idleAmount: 0.97, vanishAmount: 0 },
      532,
    );
    expect(state.idleAmount).toBeGreaterThan(0.97);
    expect(state.idleAmount).toBeLessThan(IDLE_VANISH_START);
    expect(state.vanishAmount).toBe(0);

    const afterGate = stillStep(
      { lastNow: 532, stillMs: IDLE_DWELL_MS, idleAmount: IDLE_VANISH_START, vanishAmount: 0 },
      548,
    );
    expect(afterGate.idleAmount).toBeGreaterThanOrEqual(IDLE_VANISH_START);
    expect(afterGate.vanishAmount).toBeCloseTo(IDLE_VANISH_LERP_UP, 8);
    expect(IDLE_VANISH_LERP_UP).toBeCloseTo(IDLE_LERP_UP / 16, 8);
  });

  it('eases vanish back on move at idle-out speed', () => {
    const down = stepGalleryIdle({
      now: 1000,
      lastNow: 984,
      stillMs: 400,
      idleAmount: 1,
      vanishAmount: 0.8,
      velocity: 0.4,
      scrollTarget: 40,
      scrollCurrent: 10,
      reducedMotion: false,
    });
    expect(down.idleAmount).toBeCloseTo(1 * (1 - IDLE_LERP_DOWN), 8);
    expect(down.vanishAmount).toBeCloseTo(0.8 * (1 - IDLE_LERP_DOWN), 8);
  });
});

describe('coverScaleForStack', () => {
  it('covers a landscape photo on a square stack', () => {
    expect(coverScaleForStack(100, 100, 200, 100)).toBeCloseTo(2, 8);
  });

  it('covers a portrait photo on a square stack', () => {
    expect(coverScaleForStack(100, 100, 100, 200)).toBeCloseTo(2, 8);
  });

  it('is 1 when the photo already matches the stack', () => {
    expect(coverScaleForStack(100, 100, 50, 50)).toBeCloseTo(1, 8);
  });

  it('is 1 when size is missing', () => {
    expect(coverScaleForStack(100, 100, 0, 80)).toBe(1);
    expect(coverScaleForStack(0, 100, 80, 80)).toBe(1);
    expect(coverScaleForStack(100, 100, Number.NaN, 80)).toBe(1);
  });

  it('prefers natural image size and falls back to attachment size', () => {
    expect(resolveIdleImageSize({ naturalWidth: 1600, naturalHeight: 900 }, 10, 10)).toEqual({
      width: 1600,
      height: 900,
    });
    expect(resolveIdleImageSize({ naturalWidth: 0, naturalHeight: 0 }, 400, 300)).toEqual({
      width: 400,
      height: 300,
    });
    expect(resolveIdleImageSize(null)).toEqual({ width: 0, height: 0 });
  });

  it('composes garnish scale with contain-to-cover idle', () => {
    expect(composeIdleImageScale(1.01, 2, 0)).toBeCloseTo(1.01, 8);
    expect(composeIdleImageScale(1.01, 2, 1)).toBeCloseTo(2.02, 8);
    expect(composeIdleImageScale(1, 2, 0.5)).toBeCloseTo(1.5, 8);
  });
});

describe('containRectForStack', () => {
  it('letterboxes a 16:9 photo in a square stack', () => {
    const rect = containRectForStack(300, 300, 16, 9);
    expect(rect.width).toBe(300);
    expect(rect.height).toBeCloseTo(168.75, 8);
    expect(rect.left).toBe(0);
    expect(rect.top).toBeCloseTo((300 - 168.75) / 2, 8);
  });

  it('pillarboxes a 9:16 photo in a square stack', () => {
    const rect = containRectForStack(300, 300, 9, 16);
    expect(rect.height).toBe(300);
    expect(rect.width).toBeCloseTo(168.75, 8);
    expect(rect.top).toBe(0);
    expect(rect.left).toBeCloseTo((300 - 168.75) / 2, 8);
  });

  it('fills the stack when the photo is already square', () => {
    expect(containRectForStack(300, 300, 100, 100)).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
  });

  it('falls back to the full stack when size is missing', () => {
    expect(containRectForStack(300, 300, 0, 80)).toEqual({ left: 0, top: 0, width: 300, height: 300 });
    expect(containRectForStack(0, 100, 80, 80)).toEqual({ left: 0, top: 0, width: 0, height: 100 });
    expect(containRectForStack(300, 300, Number.NaN, 80)).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
  });
});

describe('frameExpandScaleForOverlay', () => {
  it('hits the overlay height first for a square stack in a wider overlay', () => {
    const stackW = 100;
    const stackH = 100;
    const overlayW = 400;
    const overlayH = 200;
    const visualScale = 1;
    const visualH = stackH * visualScale;
    expect(frameExpandScaleForOverlay(stackW, stackH, overlayW, overlayH, visualScale)).toBeCloseTo(
      overlayH / visualH,
      8,
    );
  });

  it('uses portrait visualScale instead of layout-only stack size', () => {
    const layoutOnly = frameExpandScaleForOverlay(100, 100, 400, 200, 1);
    const portrait = frameExpandScaleForOverlay(100, 100, 400, 200, 0.65);
    expect(portrait).toBeCloseTo(200 / (100 * 0.65), 8);
    expect(portrait).not.toBeCloseTo(layoutOnly, 8);
    expect(portrait).toBeGreaterThan(layoutOnly);
  });

  it('is 1 when size is missing or non-positive', () => {
    expect(frameExpandScaleForOverlay(0, 100, 400, 200, 1)).toBe(1);
    expect(frameExpandScaleForOverlay(100, 100, 0, 200, 1)).toBe(1);
    expect(frameExpandScaleForOverlay(100, 100, 400, 200, 0)).toBe(1);
    expect(frameExpandScaleForOverlay(100, 100, Number.NaN, 200, 1)).toBe(1);
    expect(frameExpandScaleForOverlay(100, 100, 400, 200, Number.NaN)).toBe(1);
  });

  it('composes frame expand with idleAmount', () => {
    expect(composeIdleFrameScale(2, 0)).toBeCloseTo(1, 8);
    expect(composeIdleFrameScale(2, 1)).toBeCloseTo(2, 8);
    expect(composeIdleFrameScale(2, 0.5)).toBeCloseTo(1.5, 8);
  });
});

describe('composeOrnamentScale', () => {
  it('lerps reaction scale 2.5 → 1.12 with idle', () => {
    expect(composeOrnamentScale(ORNAMENT_SCROLL_REACTION_SCALE, IDLE_CHIP_SCALE, 0)).toBeCloseTo(2.5, 8);
    expect(composeOrnamentScale(ORNAMENT_SCROLL_REACTION_SCALE, IDLE_CHIP_SCALE, 0.5)).toBeCloseTo(
      (2.5 + 1.12) / 2,
      8,
    );
    expect(composeOrnamentScale(ORNAMENT_SCROLL_REACTION_SCALE, IDLE_CHIP_SCALE, 1)).toBeCloseTo(1.12, 8);
  });

  it('lerps comment 1.4 → 1.12 and author 1.4 → 1.0 with idle', () => {
    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, IDLE_CHIP_SCALE, 0)).toBeCloseTo(1.4, 8);
    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, IDLE_CHIP_SCALE, 0.5)).toBeCloseTo(
      (1.4 + 1.12) / 2,
      8,
    );
    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, IDLE_CHIP_SCALE, 1)).toBeCloseTo(1.12, 8);

    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, 1, 0)).toBeCloseTo(1.4, 8);
    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, 1, 0.5)).toBeCloseTo(1.2, 8);
    expect(composeOrnamentScale(ORNAMENT_SCROLL_TEXT_SCALE, 1, 1)).toBeCloseTo(1, 8);
  });
});

describe('inner polar idle slots', () => {
  it('is stable for the same ids and closer to center than rest', () => {
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
    expect(a.reactions.map((row) => [row.id, row.innerRadiusPct, row.innerLeftPct, row.innerTopPct])).toEqual(
      b.reactions.map((row) => [row.id, row.innerRadiusPct, row.innerLeftPct, row.innerTopPct]),
    );
    expect(a.comments.map((row) => [row.id, row.innerRadiusPct, row.innerLeftPct, row.innerTopPct])).toEqual(
      b.comments.map((row) => [row.id, row.innerRadiusPct, row.innerLeftPct, row.innerTopPct]),
    );
    for (const row of [...a.reactions, ...a.comments]) {
      expect(row.innerRadiusPct).toBeGreaterThanOrEqual(INNER_RADIUS_MIN);
      expect(row.innerRadiusPct).toBeLessThanOrEqual(INNER_RADIUS_MAX);
      expect(row.innerRadiusPct).toBeLessThan(row.radiusPct);
    }
  });
});
