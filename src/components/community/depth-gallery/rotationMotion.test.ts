import { describe, expect, it } from 'vitest';
import {
  FLOW_EXIT_X,
  IDENTITY_LAYER_MOTION,
  PORTRAIT_STACK_SCALE,
  PORTRAIT_VIEWPORT_H_CAP,
  computeGalleryOffsets,
  computeRotationMotion,
  exitSignsFromOrientation,
  getStableOrientation,
  layerMotionForGalleryIndex,
  layerTransformCss,
  smoothstep,
  visualZOffset,
} from './rotationMotion';

describe('getStableOrientation', () => {
  it('returns the same orientation for the same postId', () => {
    expect(getStableOrientation('post-a')).toEqual(getStableOrientation('post-a'));
  });

  it('varies across different post ids', () => {
    expect(getStableOrientation('post-a')).not.toEqual(getStableOrientation('post-b'));
  });
});

describe('computeRotationMotion', () => {
  const current = { rotateX: 80, rotateY: 10, rotateZ: -8 };
  const next = { rotateX: 90, rotateY: -12, rotateZ: 6 };
  const maxH = 400;
  const maxV = 40;
  const offsets = { maxHorizontalOffset: maxH, maxVerticalOffset: maxV };
  const { exitX, exitY } = exitSignsFromOrientation(current);

  it('keeps current neutral and next fully incoming at blend 0', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0,
      ...offsets,
    });
    expect(motion.current.rotateX).toBeCloseTo(0, 8);
    expect(motion.current.rotateY).toBeCloseTo(0, 8);
    expect(motion.current.rotateZ).toBeCloseTo(0, 8);
    expect(motion.current.translateX).toBeCloseTo(0, 8);
    expect(motion.current.translateY).toBeCloseTo(0, 8);
    expect(motion.current.translateZ).toBeCloseTo(0, 8);
    expect(motion.next.rotateX).toBeCloseTo(next.rotateX, 8);
    expect(motion.next.rotateY).toBeCloseTo(next.rotateY, 8);
    expect(motion.next.rotateZ).toBeCloseTo(next.rotateZ, 8);
    expect(motion.next.translateX).toBeCloseTo(-exitX * maxH, 8);
    expect(motion.next.translateY).toBeCloseTo(-exitY * maxV, 8);
  });

  it('rotates current fully away and leaves next neutral at blend 1', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 1,
      ...offsets,
    });
    expect(motion.current.rotateX).toBeCloseTo(-current.rotateX, 8);
    expect(motion.current.rotateY).toBeCloseTo(-current.rotateY, 8);
    expect(motion.current.rotateZ).toBeCloseTo(-current.rotateZ, 8);
    expect(motion.current.translateX).toBeCloseTo(exitX * maxH, 8);
    expect(motion.current.translateY).toBeCloseTo(exitY * maxV, 8);
    expect(motion.next.rotateX).toBeCloseTo(0, 8);
    expect(motion.next.rotateY).toBeCloseTo(0, 8);
    expect(motion.next.rotateZ).toBeCloseTo(0, 8);
    expect(motion.next.translateX).toBeCloseTo(0, 8);
    expect(motion.next.translateY).toBeCloseTo(0, 8);
    expect(motion.next.translateZ).toBeCloseTo(0, 8);
  });

  it('places complementary orientations and deepest Z at blend 0.5', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.5,
      ...offsets,
    });
    expect(motion.current.rotateX).toBeCloseTo(-current.rotateX * 0.5, 8);
    expect(motion.next.rotateX).toBeCloseTo(next.rotateX * 0.5, 8);
    expect(motion.current.translateZ).toBeCloseTo(visualZOffset(0.5), 8);
    expect(motion.next.translateZ).toBe(motion.current.translateZ);
    expect(motion.current.translateZ).toBeLessThan(0);
  });

  it('flows left-to-right: next enters from the left, current exits right', () => {
    const early = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.25,
      ...offsets,
    });
    const later = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.75,
      ...offsets,
    });
    expect(early.next.translateX).toBeLessThan(0);
    expect(early.current.translateX).toBeGreaterThan(0);
    expect(later.current.translateX).toBeGreaterThan(early.current.translateX);
    expect(later.next.translateX).toBeGreaterThan(early.next.translateX);
  });

  it('keeps a left-to-right XY gap equal to maxH at blend 0.5', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.5,
      ...offsets,
    });
    expect(motion.current.translateX).toBeGreaterThan(0);
    expect(motion.next.translateX).toBeLessThan(0);
    expect(Math.abs(motion.current.translateX - motion.next.translateX)).toBeCloseTo(maxH, 8);
    expect(Math.abs(motion.current.translateY - motion.next.translateY)).toBeCloseTo(Math.abs(exitY) * maxV, 8);
  });

  it('does not flip horizontal direction from hashed rotateY', () => {
    expect(exitSignsFromOrientation({ rotateX: 80, rotateY: 10, rotateZ: -8 }).exitX).toBe(FLOW_EXIT_X);
    expect(exitSignsFromOrientation({ rotateX: 80, rotateY: -12, rotateZ: 6 }).exitX).toBe(FLOW_EXIT_X);
  });

  it('holds constant center-to-center distance for the whole blend', () => {
    for (const blend of [0, 0.25, 0.5, 0.75, 1]) {
      const motion = computeRotationMotion({
        currentOrientation: current,
        nextOrientation: next,
        depthBlend: blend,
        ...offsets,
      });
      expect(Math.abs(motion.current.translateX - motion.next.translateX)).toBeCloseTo(maxH, 8);
    }
  });

  it('reverses with depthBlend (0.25 vs 0.75 are not sticky state)', () => {
    const forward = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.25,
      ...offsets,
    });
    const reverse = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.25,
      ...offsets,
    });
    expect(reverse).toEqual(forward);
    const later = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.75,
      ...offsets,
    });
    expect(later.current.rotateX).toBeCloseTo(-current.rotateX * 0.75, 8);
    expect(later.next.rotateX).toBeCloseTo(next.rotateX * 0.25, 8);
    expect(later.current.translateX).not.toBeCloseTo(forward.current.translateX, 5);
    expect(later.next.translateX).not.toBeCloseTo(forward.next.translateX, 5);
    expect(later.current.translateX).toBeCloseTo(exitX * maxH * smoothstep(0.75), 8);
    expect(forward.current.translateX).toBeCloseTo(exitX * maxH * smoothstep(0.25), 8);
  });

  it('has no transform jump when next becomes current', () => {
    const atOne = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 1,
      ...offsets,
    });
    const asNewCurrent = computeRotationMotion({
      currentOrientation: next,
      nextOrientation: { rotateX: 75, rotateY: 4, rotateZ: 3 },
      depthBlend: 0,
      ...offsets,
    });
    expect(atOne.next.rotateX).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.rotateX).toBeCloseTo(0, 8);
    expect(atOne.next.translateZ).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.translateZ).toBeCloseTo(0, 8);
    expect(atOne.next.translateX).toBeCloseTo(0, 8);
    expect(atOne.next.translateY).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.translateX).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.translateY).toBeCloseTo(0, 8);
  });

  it('zeros all 3D when reducedMotion is set', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.5,
      reducedMotion: true,
      ...offsets,
    });
    expect(motion.current).toEqual(IDENTITY_LAYER_MOTION);
    expect(motion.next).toEqual(IDENTITY_LAYER_MOTION);
  });
});

describe('layerMotionForGalleryIndex', () => {
  const orientations = [
    { rotateX: 80, rotateY: 10, rotateZ: -8 },
    { rotateX: 90, rotateY: -12, rotateZ: 6 },
    { rotateX: 75, rotateY: 4, rotateZ: 3 },
  ];
  const maxH = 400;
  const maxV = 40;
  const shared = {
    orientations,
    maxHorizontalOffset: maxH,
    maxVerticalOffset: maxV,
  };

  it('parks previous at current motion for blend 1', () => {
    const rest = layerMotionForGalleryIndex({
      index: 0,
      currentIndex: 1,
      nextIndex: 2,
      depthBlend: 0.4,
      ...shared,
    });
    const completed = computeRotationMotion({
      currentOrientation: orientations[0],
      nextOrientation: orientations[1],
      depthBlend: 1,
      maxHorizontalOffset: maxH,
      maxVerticalOffset: maxV,
    }).current;
    expect(rest).toEqual(completed);
    expect(Math.abs(rest.translateX)).toBeGreaterThan(0);
  });

  it('stays at 0,0 when last plane is both current and next', () => {
    const motion = layerMotionForGalleryIndex({
      index: 2,
      currentIndex: 2,
      nextIndex: 2,
      depthBlend: 0,
      ...shared,
    });
    expect(motion.translateX).toBeCloseTo(0, 8);
    expect(motion.translateY).toBeCloseTo(0, 8);
    expect(motion.translateZ).toBeCloseTo(0, 8);
    expect(motion.rotateX).toBeCloseTo(0, 8);
  });

  it('matches live current at blend 1 after index handoff (no XY jump)', () => {
    const before = computeRotationMotion({
      currentOrientation: orientations[0],
      nextOrientation: orientations[1],
      depthBlend: 1,
      maxHorizontalOffset: maxH,
      maxVerticalOffset: maxV,
    }).current;
    const after = layerMotionForGalleryIndex({
      index: 0,
      currentIndex: 1,
      nextIndex: 2,
      depthBlend: 0,
      ...shared,
    });
    expect(after.translateX).toBeCloseTo(before.translateX, 8);
    expect(after.translateY).toBeCloseTo(before.translateY, 8);
  });
});

describe('layerTransformCss', () => {
  it('returns none for identity', () => {
    expect(layerTransformCss(IDENTITY_LAYER_MOTION)).toBe('none');
  });

  it('starts with translate3d when motion is non-identity', () => {
    const css = layerTransformCss({
      rotateX: 10,
      rotateY: -4,
      rotateZ: 2,
      translateX: 120,
      translateY: -8,
      translateZ: -20,
    });
    expect(css.startsWith('translate3d(')).toBe(true);
  });
});

describe('computeGalleryOffsets', () => {
  it('uses desktop stack ratios within clamps', () => {
    const offsets = computeGalleryOffsets({
      stackWidth: 720,
      stackHeight: 720,
      overlayWidth: 1440,
      isPortrait: false,
    });
    expect(offsets.maxHorizontalOffset).toBeCloseTo(720 * 1.08, 8);
    expect(offsets.maxVerticalOffset).toBeCloseTo(clampHint(720 * 0.14, 24, 110), 8);
  });

  it('caps portrait maxH by overlay width and stack scale', () => {
    const offsets = computeGalleryOffsets({
      stackWidth: 335,
      stackHeight: 500,
      overlayWidth: 390,
      isPortrait: true,
    });
    const ratio = 335 * 1.08;
    const viewportCap = (390 * PORTRAIT_VIEWPORT_H_CAP) / PORTRAIT_STACK_SCALE;
    expect(offsets.maxHorizontalOffset).toBeCloseTo(Math.min(ratio, viewportCap), 8);
    expect(offsets.maxHorizontalOffset).toBeGreaterThan(335);
  });
});

function clampHint(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
