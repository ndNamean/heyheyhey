import { describe, expect, it } from 'vitest';
import {
  RIPPLE_PRE_VANISH_MIN,
  RIPPLE_VANISH_THRESHOLD,
  ornamentRippleAuthorKey,
  ornamentRippleCommentKey,
  ornamentRippleReactionKey,
  ornamentRippleShouldFire,
  ornamentRippleShouldReset,
} from './ornamentRipple';

const ready = {
  still: true,
  reducedMotion: false,
  vanishAmount: RIPPLE_VANISH_THRESHOLD,
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

describe('ornamentRippleShouldReset', () => {
  it('resets when not still or when reduced motion is on', () => {
    expect(ornamentRippleShouldReset({ still: false, reducedMotion: false })).toBe(true);
    expect(ornamentRippleShouldReset({ still: true, reducedMotion: true })).toBe(true);
    expect(ornamentRippleShouldReset({ still: true, reducedMotion: false })).toBe(false);
  });
});
