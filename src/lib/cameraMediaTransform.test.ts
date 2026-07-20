import { describe, expect, it } from 'vitest';
import {
  computeContainedMediaRect,
  getEffectiveDimensions,
  nextManualRotation,
  normalizeManualRotation,
} from './cameraMediaTransform';

describe('cameraMediaTransform', () => {
  it('normalizes and cycles manual rotation clockwise', () => {
    expect(normalizeManualRotation(0)).toBe(0);
    expect(normalizeManualRotation(450)).toBe(90);
    expect(nextManualRotation(0)).toBe(90);
    expect(nextManualRotation(90)).toBe(180);
    expect(nextManualRotation(180)).toBe(270);
    expect(nextManualRotation(270)).toBe(0);
  });

  it('swaps effective dimensions at 90 and 270', () => {
    expect(getEffectiveDimensions(1920, 1080, 0)).toEqual({ w: 1920, h: 1080 });
    expect(getEffectiveDimensions(1920, 1080, 90)).toEqual({ w: 1080, h: 1920 });
    expect(getEffectiveDimensions(1920, 1080, 180)).toEqual({ w: 1920, h: 1080 });
    expect(getEffectiveDimensions(1920, 1080, 270)).toEqual({ w: 1080, h: 1920 });
  });

  it('computes contain rect without stretch for portrait viewfinder', () => {
    const rect = computeContainedMediaRect(390, 700, 1920, 1080, 0);
    expect(rect).not.toBeNull();
    expect(rect!.effectiveW).toBe(1920);
    expect(rect!.effectiveH).toBe(1080);
    expect(rect!.displayW / rect!.displayH).toBeCloseTo(1920 / 1080, 5);
    expect(rect!.displayW).toBeLessThanOrEqual(390 + 0.01);
    expect(rect!.displayH).toBeLessThanOrEqual(700 + 0.01);
    expect(rect!.offsetX).toBeGreaterThanOrEqual(0);
    expect(rect!.offsetY).toBeGreaterThanOrEqual(0);
  });

  it('uses swapped aspect for 90-degree contain in landscape viewfinder', () => {
    const rect = computeContainedMediaRect(800, 360, 1920, 1080, 90);
    expect(rect).not.toBeNull();
    expect(rect!.effectiveW).toBe(1080);
    expect(rect!.effectiveH).toBe(1920);
    // Tall effective media in short landscape viewport → pillar/letterbox by width
    expect(rect!.displayW / rect!.displayH).toBeCloseTo(1080 / 1920, 5);
    expect(rect!.displayH).toBeLessThanOrEqual(360 + 0.01);
  });

  it('returns null for invalid sizes', () => {
    expect(computeContainedMediaRect(0, 100, 1920, 1080, 0)).toBeNull();
    expect(computeContainedMediaRect(100, 100, 0, 1080, 0)).toBeNull();
  });
});
