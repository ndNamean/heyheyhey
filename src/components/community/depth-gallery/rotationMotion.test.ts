import { describe, expect, it } from 'vitest';
import {
  IDENTITY_LAYER_MOTION,
  computeRotationMotion,
  getStableOrientation,
  layerTransformCss,
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

  it('keeps current neutral and next fully incoming at blend 0', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0,
    });
    expect(motion.current.rotateX).toBeCloseTo(0, 8);
    expect(motion.current.rotateY).toBeCloseTo(0, 8);
    expect(motion.current.rotateZ).toBeCloseTo(0, 8);
    expect(motion.current.translateZ).toBeCloseTo(0, 8);
    expect(motion.next.rotateX).toBeCloseTo(next.rotateX, 8);
    expect(motion.next.rotateY).toBeCloseTo(next.rotateY, 8);
    expect(motion.next.rotateZ).toBeCloseTo(next.rotateZ, 8);
  });

  it('rotates current fully away and leaves next neutral at blend 1', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 1,
    });
    expect(motion.current.rotateX).toBeCloseTo(-current.rotateX, 8);
    expect(motion.current.rotateY).toBeCloseTo(-current.rotateY, 8);
    expect(motion.current.rotateZ).toBeCloseTo(-current.rotateZ, 8);
    expect(motion.next.rotateX).toBeCloseTo(0, 8);
    expect(motion.next.rotateY).toBeCloseTo(0, 8);
    expect(motion.next.rotateZ).toBeCloseTo(0, 8);
    expect(motion.next.translateZ).toBeCloseTo(0, 8);
  });

  it('places complementary orientations and deepest Z at blend 0.5', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.5,
    });
    expect(motion.current.rotateX).toBeCloseTo(-current.rotateX * 0.5, 8);
    expect(motion.next.rotateX).toBeCloseTo(next.rotateX * 0.5, 8);
    expect(motion.current.translateZ).toBeCloseTo(visualZOffset(0.5), 8);
    expect(motion.next.translateZ).toBe(motion.current.translateZ);
    expect(motion.current.translateZ).toBeLessThan(0);
  });

  it('reverses with depthBlend (0.25 vs 0.75 are not sticky state)', () => {
    const forward = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.25,
    });
    const reverse = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.25,
    });
    expect(reverse).toEqual(forward);
    const later = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.75,
    });
    expect(later.current.rotateX).toBeCloseTo(-current.rotateX * 0.75, 8);
    expect(later.next.rotateX).toBeCloseTo(next.rotateX * 0.25, 8);
  });

  it('has no transform jump when next becomes current', () => {
    const atOne = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 1,
    });
    const asNewCurrent = computeRotationMotion({
      currentOrientation: next,
      nextOrientation: { rotateX: 75, rotateY: 4, rotateZ: 3 },
      depthBlend: 0,
    });
    expect(atOne.next.rotateX).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.rotateX).toBeCloseTo(0, 8);
    expect(atOne.next.translateZ).toBeCloseTo(0, 8);
    expect(asNewCurrent.current.translateZ).toBeCloseTo(0, 8);
  });

  it('zeros all 3D when reducedMotion is set', () => {
    const motion = computeRotationMotion({
      currentOrientation: current,
      nextOrientation: next,
      depthBlend: 0.5,
      reducedMotion: true,
    });
    expect(motion.current).toEqual(IDENTITY_LAYER_MOTION);
    expect(motion.next).toEqual(IDENTITY_LAYER_MOTION);
  });
});

describe('layerTransformCss', () => {
  it('returns none for identity', () => {
    expect(layerTransformCss(IDENTITY_LAYER_MOTION)).toBe('none');
  });
});
