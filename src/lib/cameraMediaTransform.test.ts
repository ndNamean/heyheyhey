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
  resolveCaptureFrameRotation,
  liveWatermarkOverlayStyle,
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

  it('resolves landscape save rotation from tilt or OS landscape', () => {
    // CSS tilt is CW; canvas frame rotation is inverted (90↔270).
    expect(
      resolveCaptureFrameRotation({
        layoutOrientation: 'portrait',
        watermarkTilt: 270,
        sourceW: 1080,
        sourceH: 1920,
      }),
    ).toBe(90);
    expect(
      resolveCaptureFrameRotation({
        layoutOrientation: 'portrait',
        watermarkTilt: 90,
        sourceW: 1080,
        sourceH: 1920,
      }),
    ).toBe(270);
    expect(
      resolveCaptureFrameRotation({
        layoutOrientation: 'landscape',
        watermarkTilt: 0,
        sourceW: 1080,
        sourceH: 1920,
        screenAngle: 90,
      }),
    ).toBe(270);
    expect(
      resolveCaptureFrameRotation({
        layoutOrientation: 'portrait',
        watermarkTilt: 0,
        sourceW: 1080,
        sourceH: 1920,
      }),
    ).toBe(0);
  });

  it('keeps live tilt overlay anchored so 270deg does not use bottom-left origin', () => {
    expect(liveWatermarkOverlayStyle(0.5, 90).transformOrigin).toBe('bottom left');
    expect(liveWatermarkOverlayStyle(0.5, 270).transformOrigin).toBe('bottom right');
    expect(liveWatermarkOverlayStyle(0.5, 270).right).toBe(0);
    expect(liveWatermarkOverlayStyle(0.5, 0).transform).toBe('scale(0.5)');
  });
});
