import { describe, expect, it } from 'vitest';
import { IDLE_VANISH_START } from './galleryIdle';
import {
  RIPPLE_PRE_VANISH_MIN,
  RIPPLE_VANISH_THRESHOLD,
  ornamentRippleAuthorKey,
  ornamentRippleCommentKey,
  ornamentRippleReactionKey,
  ornamentRippleShouldFire,
  ornamentRippleShouldFireStart,
  ornamentRippleShouldReset,
} from './ornamentRipple';

const ready = {
  still: true,
  reducedMotion: false,
  vanishAmount: RIPPLE_VANISH_THRESHOLD,
  preVanishOpacity: 1,
  alreadyFired: false,
};

const startReady = {
  still: true,
  reducedMotion: false,
  idleAmount: IDLE_VANISH_START,
  vanishAmount: 0.004375,
  preVanishOpacity: 1,
  alreadyFired: false,
};

describe('ornamentRipple keys', () => {
  it('builds reaction, comment, and author keys', () => {
    expect(ornamentRippleReactionKey('post-a', 'r1')).toBe('post-a:reaction:r1');
    expect(ornamentRippleCommentKey('post-a', 'c1')).toBe('post-a:comment:c1');
    expect(ornamentRippleAuthorKey('post-a')).toBe('post-a:author');
  });
});

describe('ornamentRippleShouldFire', () => {
  it('is false until vanishAmount reaches 0.99', () => {
    expect(ornamentRippleShouldFire({ ...ready, vanishAmount: 0.989 })).toBe(false);
    expect(ornamentRippleShouldFire({ ...ready, vanishAmount: 0.99 })).toBe(true);
    expect(ornamentRippleShouldFire({ ...ready, vanishAmount: 1 })).toBe(true);
  });

  it('is false when pre-vanish opacity is below the visible floor', () => {
    expect(ornamentRippleShouldFire({ ...ready, preVanishOpacity: 0 })).toBe(false);
    expect(ornamentRippleShouldFire({ ...ready, preVanishOpacity: RIPPLE_PRE_VANISH_MIN - 0.01 })).toBe(
      false,
    );
    expect(ornamentRippleShouldFire({ ...ready, preVanishOpacity: RIPPLE_PRE_VANISH_MIN })).toBe(true);
  });

  it('is false when already fired', () => {
    expect(ornamentRippleShouldFire({ ...ready, alreadyFired: true })).toBe(false);
  });

  it('is false when reduced motion is on', () => {
    expect(ornamentRippleShouldFire({ ...ready, reducedMotion: true })).toBe(false);
  });

  it('is false when the gallery is not still', () => {
    expect(ornamentRippleShouldFire({ ...ready, still: false })).toBe(false);
  });
});

describe('ornamentRippleShouldFireStart', () => {
  it('is true on the first vanish lerp after idle walk-in, not at 0.99', () => {
    expect(ornamentRippleShouldFireStart({ ...startReady, vanishAmount: 0 })).toBe(false);
    expect(ornamentRippleShouldFireStart({ ...startReady, idleAmount: 0.97, vanishAmount: 0.01 })).toBe(
      false,
    );
    expect(ornamentRippleShouldFireStart(startReady)).toBe(true);
    expect(ornamentRippleShouldFireStart({ ...startReady, vanishAmount: RIPPLE_VANISH_THRESHOLD })).toBe(
      false,
    );
  });

  it('does not share the gone-pulse alreadyFired flag', () => {
    expect(ornamentRippleShouldFireStart({ ...startReady, alreadyFired: true })).toBe(false);
    expect(ornamentRippleShouldFire({ ...ready, alreadyFired: false })).toBe(true);
  });

  it('is false when reduced motion is on or the gallery is moving', () => {
    expect(ornamentRippleShouldFireStart({ ...startReady, reducedMotion: true })).toBe(false);
    expect(ornamentRippleShouldFireStart({ ...startReady, still: false })).toBe(false);
  });
});

describe('ornamentRippleShouldReset', () => {
  it('resets when not still or when reduced motion is on', () => {
    expect(ornamentRippleShouldReset({ still: false, reducedMotion: false })).toBe(true);
    expect(ornamentRippleShouldReset({ still: true, reducedMotion: true })).toBe(true);
    expect(ornamentRippleShouldReset({ still: true, reducedMotion: false })).toBe(false);
  });
});
