import { describe, expect, it } from 'vitest';
import {
  DEPTH_SAMPLE_OFFSET,
  GalleryLayers,
  MOOD_SAMPLE_OFFSET,
  PLANE_FADE_SAMPLE_OFFSET,
  PLANE_FADE_SMOOTHING,
  PLANE_GAP,
  computeDepthBlend,
  getDepthRange,
  getPlaneZ,
  opacityTargets,
  smoothOpacities,
} from './galleryLayers';

describe('plane layout', () => {
  it('places plane i at z = -i * planeGap (5)', () => {
    expect(PLANE_GAP).toBe(5);
    expect(getPlaneZ(0)).toBe(0);
    expect(getPlaneZ(1)).toBe(-5);
    expect(getPlaneZ(4)).toBe(-20);
  });

  it('reports nearest and deepest Z', () => {
    expect(getDepthRange(0)).toEqual({ nearestZ: 0, deepestZ: 0 });
    expect(getDepthRange(5)).toEqual({ nearestZ: 0, deepestZ: -20 });
  });
});

describe('shared depthBlend', () => {
  it('uses moodSampleOffset 1 matching plane fade offset', () => {
    expect(MOOD_SAMPLE_OFFSET).toBe(1);
    expect(PLANE_FADE_SAMPLE_OFFSET).toBe(1);
    expect(DEPTH_SAMPLE_OFFSET).toBe(1);
  });

  it('returns current/next/blend from camera Z', () => {
    const layers = new GalleryLayers(5);
    const atStart = layers.getDepthBlend(5);
    expect(atStart.currentPlaneIndex).toBe(0);
    expect(atStart.nextPlaneIndex).toBe(1);
    expect(atStart.depthBlend).toBeCloseTo(0, 8);

    const halfwayToNext = layers.getDepthBlend(2.5);
    expect(halfwayToNext.currentPlaneIndex).toBe(0);
    expect(halfwayToNext.nextPlaneIndex).toBe(1);
    expect(halfwayToNext.depthBlend).toBeCloseTo(0.5, 8);
  });

  it('shares one depthBlend for mood and plane fade', () => {
    const layers = new GalleryLayers(5);
    for (const cameraZ of [5, 2.5, 0, -7.5, -15]) {
      const mood = layers.getMoodBlendData(cameraZ);
      const planes = layers.getPlaneBlendData(cameraZ);
      expect(mood).toEqual(planes);
    }
  });

  it('leads the visible plane by one gap (sample offset 1)', () => {
    const withLead = computeDepthBlend(0, 5, 1);
    expect(withLead.currentPlaneIndex).toBe(1);
    expect(withLead.depthBlend).toBeCloseTo(0, 8);

    const withoutLead = computeDepthBlend(0, 5, 0);
    expect(withoutLead.currentPlaneIndex).toBe(0);
    expect(withoutLead.depthBlend).toBeCloseTo(0, 8);
  });

  it('clamps to the last plane', () => {
    const deep = computeDepthBlend(-40, 5);
    expect(deep.currentPlaneIndex).toBe(4);
    expect(deep.nextPlaneIndex).toBe(4);
    expect(deep.depthBlend).toBe(0);
  });
});

describe('opacity smoothing', () => {
  it('targets 1-blend on current and blend on next; distant planes 0', () => {
    expect(PLANE_FADE_SMOOTHING).toBe(0.14);
    const blend = computeDepthBlend(2.5, 5);
    expect(blend.depthBlend).toBeCloseTo(0.5, 8);
    const targets = opacityTargets(5, blend);
    expect(targets).toHaveLength(5);
    expect(targets[blend.currentPlaneIndex]).toBeCloseTo(0.5, 8);
    expect(targets[blend.nextPlaneIndex]).toBeCloseTo(0.5, 8);
    expect(targets.filter((_, i) => i !== blend.currentPlaneIndex && i !== blend.nextPlaneIndex)).toEqual([
      0, 0, 0,
    ]);
  });

  it('lerps opacities toward targets with 0.14', () => {
    const current = [1, 0, 0, 0, 0];
    const targets = [0.5, 0.5, 0, 0, 0];
    const next = smoothOpacities(current, targets, PLANE_FADE_SMOOTHING);
    expect(next[0]).toBeCloseTo(1 + (0.5 - 1) * 0.14, 8);
    expect(next[1]).toBeCloseTo(0 + 0.5 * 0.14, 8);
    expect(next[2]).toBe(0);
  });

  it('updates instance opacities from camera Z', () => {
    const layers = new GalleryLayers(5);
    expect(layers.opacities[0]).toBe(1);
    layers.updateOpacities(2.5);
    const targets = layers.opacityTargets(2.5);
    expect(layers.opacities[0]).toBeCloseTo(1 + (targets[0] - 1) * 0.14, 8);
    expect(layers.opacities[1]).toBeCloseTo(targets[1] * 0.14, 8);
  });
});
