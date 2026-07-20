import { describe, expect, it } from 'vitest';
import {
  gravityRotationFromSensor,
  orientationFromDeviceMotion,
  orientationFromScreenAngle,
} from '../hooks/useDeviceLayoutOrientation';
import {
  computeContainedMediaRect,
  getEffectiveDimensions,
  normalizeWatermarkDirection,
} from './cameraMediaTransform';

describe('gravity / transform helpers', () => {
  it('maps screen angles to landscape near 90/270', () => {
    expect(orientationFromScreenAngle(0)).toBe('portrait');
    expect(orientationFromScreenAngle(90)).toBe('landscape');
    expect(orientationFromScreenAngle(270)).toBe('landscape');
  });

  it('infers landscape from strong gamma tilt', () => {
    expect(orientationFromDeviceMotion(10, 80)).toBe('landscape');
    expect(orientationFromDeviceMotion(70, 5)).toBe('portrait');
  });

  it('picks gravity rotation from gamma / screen angle', () => {
    expect(gravityRotationFromSensor(-70, null)).toBe(90);
    expect(gravityRotationFromSensor(70, null)).toBe(270);
    expect(gravityRotationFromSensor(null, 90)).toBe(90);
    expect(gravityRotationFromSensor(null, 270)).toBe(270);
  });

  it('swaps effective dimensions for gravity 90', () => {
    expect(getEffectiveDimensions(1920, 1080, 90)).toEqual({ w: 1080, h: 1920 });
    expect(normalizeWatermarkDirection(90)).toBe(90);
    const rect = computeContainedMediaRect(800, 360, 1920, 1080, 90);
    expect(rect?.effectiveW).toBe(1080);
  });
});
