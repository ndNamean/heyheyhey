import { describe, expect, it } from 'vitest';
import {
  orientationFromDeviceMotion,
  orientationFromScreenAngle,
} from '../hooks/useDeviceLayoutOrientation';
import {
  computeContainedMediaRect,
  getEffectiveDimensions,
  normalizeWatermarkDirection,
} from './cameraMediaTransform';
import { normalizeWatermarkDirection as normalizeFromSettings } from './cameraSettings';

describe('watermarkDirection / transform', () => {
  it('normalizes direction values', () => {
    expect(normalizeWatermarkDirection(0)).toBe(0);
    expect(normalizeWatermarkDirection(90)).toBe(90);
    expect(normalizeWatermarkDirection(450)).toBe(90);
    expect(normalizeFromSettings(undefined)).toBe(0);
    expect(normalizeFromSettings(180)).toBe(180);
  });

  it('swaps effective dimensions at 90 and 270', () => {
    expect(getEffectiveDimensions(1920, 1080, 90)).toEqual({ w: 1080, h: 1920 });
    expect(getEffectiveDimensions(1920, 1080, 0)).toEqual({ w: 1920, h: 1080 });
  });

  it('computes contain rect with watermark direction', () => {
    const rect = computeContainedMediaRect(800, 360, 1920, 1080, 90);
    expect(rect).not.toBeNull();
    expect(rect!.effectiveW).toBe(1080);
    expect(rect!.effectiveH).toBe(1920);
  });
});

describe('device layout orientation helpers', () => {
  it('maps screen angles to landscape near 90/270', () => {
    expect(orientationFromScreenAngle(0)).toBe('portrait');
    expect(orientationFromScreenAngle(90)).toBe('landscape');
    expect(orientationFromScreenAngle(270)).toBe('landscape');
    expect(orientationFromScreenAngle(180)).toBe('portrait');
  });

  it('infers landscape from strong gamma tilt', () => {
    expect(orientationFromDeviceMotion(10, 80)).toBe('landscape');
    expect(orientationFromDeviceMotion(70, 5)).toBe('portrait');
    expect(orientationFromDeviceMotion(null, 90)).toBeNull();
  });
});
