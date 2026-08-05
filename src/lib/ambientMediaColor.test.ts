// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { ambientMediaEffects } from '../config/ambientMediaEffects';
import {
  clearAmbientColorCaches,
  extractEdgeColorFromImageData,
  extractEdgeColorFromMedia,
  fallbackAmbientColor,
  getAmbientColorCacheSize,
  hasCorsFailure,
  hexToRgb,
  markCorsFailure,
  pixelSaturation,
  prefersReducedMotion,
  recallAmbientColor,
  rememberAmbientColor,
  resolveAmbientMotionMode,
  rgbToHex,
  shouldExcludePixel,
  smoothColorEma,
} from './ambientMediaColor';

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, width, height);
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('ambientMediaEffects config', () => {
  it('matches plan fallback and detection values', () => {
    expect(ambientMediaEffects.fallbackColor.hex).toBe('#FDC216');
    expect(ambientMediaEffects.fallbackColor).toMatchObject({ r: 253, g: 194, b: 22 });
    expect(ambientMediaEffects.colorDetection.canvasSize).toBe(48);
    expect(ambientMediaEffects.colorDetection.edgeInsetRatio).toBe(0.15);
    expect(ambientMediaEffects.colorDetection.minimumAlpha).toBe(48);
    expect(ambientMediaEffects.colorDetection.excludeNearBlackBelow).toBe(20);
    expect(ambientMediaEffects.colorDetection.excludeNearWhiteAbove).toBe(242);
    expect(ambientMediaEffects.colorDetection.minimumPreferredSaturation).toBe(0.18);
    expect(ambientMediaEffects.colorDetection.smoothing.alpha).toBe(0.18);
    expect(ambientMediaEffects.colorDetection.maxCacheEntries).toBe(64);
    expect(ambientMediaEffects.accessibility.reducedMotionMode).toBe('sustained-only');
  });
});

describe('pixel exclusion filters', () => {
  const filters = ambientMediaEffects.colorDetection;

  it('excludes low-alpha pixels', () => {
    expect(shouldExcludePixel(200, 40, 40, 10, filters)).toBe(true);
    expect(shouldExcludePixel(200, 40, 40, 48, filters)).toBe(false);
  });

  it('excludes near-black pixels', () => {
    expect(shouldExcludePixel(10, 8, 5, 255, filters)).toBe(true);
    expect(shouldExcludePixel(40, 30, 20, 255, filters)).toBe(false);
  });

  it('excludes near-white pixels', () => {
    expect(shouldExcludePixel(250, 248, 245, 255, filters)).toBe(true);
    expect(shouldExcludePixel(200, 80, 40, 255, filters)).toBe(false);
  });

  it('reports useful saturation for vivid colors', () => {
    expect(pixelSaturation(220, 40, 40)).toBeGreaterThan(0.18);
    expect(pixelSaturation(128, 128, 128)).toBe(0);
  });
});

describe('extractEdgeColorFromImageData', () => {
  it('samples edge and prefers saturated color over center fill', () => {
    const size = 40;
    const imageData = makeImageData(size, size, (x, y) => {
      const edge = x < 6 || x >= size - 6 || y < 6 || y >= size - 6;
      if (edge) return [220, 30, 40, 255];
      return [20, 20, 20, 255];
    });
    const color = extractEdgeColorFromImageData(imageData);
    expect(color).not.toBeNull();
    expect(color!.r).toBeGreaterThan(150);
    expect(color!.g).toBeLessThan(80);
  });

  it('falls through to null when only excluded pixels exist on edges', () => {
    const size = 32;
    const imageData = makeImageData(size, size, () => [5, 5, 5, 10]);
    expect(extractEdgeColorFromImageData(imageData)).toBeNull();
  });

  it('ignores transparent edge and uses opaque saturated band', () => {
    const size = 32;
    const imageData = makeImageData(size, size, (x, y) => {
      const onTop = y < 5;
      if (onTop && x < size / 2) return [0, 0, 0, 0];
      if (onTop) return [40, 180, 60, 255];
      return [250, 250, 250, 255];
    });
    const color = extractEdgeColorFromImageData(imageData);
    expect(color).not.toBeNull();
    expect(color!.g).toBeGreaterThan(color!.r);
  });
});

describe('EMA smoothing', () => {
  it('moves partially toward next sample', () => {
    const prev = { r: 0, g: 0, b: 0 };
    const next = { r: 100, g: 100, b: 100 };
    const smoothed = smoothColorEma(prev, next, 0.18);
    expect(smoothed.r).toBeCloseTo(18, 5);
    expect(smoothed.g).toBeCloseTo(18, 5);
    expect(smoothed.b).toBeCloseTo(18, 5);
  });

  it('returns next when previous is null or alpha is 1', () => {
    expect(smoothColorEma(null, { r: 10, g: 20, b: 30 }, 0.18)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
    expect(smoothColorEma({ r: 0, g: 0, b: 0 }, { r: 10, g: 20, b: 30 }, 1)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });
});

describe('fallback and CORS', () => {
  beforeEach(() => {
    clearAmbientColorCaches();
  });

  it('uses #FDC216 fallback helpers', () => {
    expect(fallbackAmbientColor()).toEqual({ r: 253, g: 194, b: 22 });
    expect(rgbToHex(fallbackAmbientColor())).toBe('#FDC216');
    expect(hexToRgb('#FDC216')).toEqual({ r: 253, g: 194, b: 22 });
  });

  it('marks CORS failures and returns gold fallback without retry', () => {
    markCorsFailure('https://giphy.example/x.gif');
    expect(hasCorsFailure('https://giphy.example/x.gif')).toBe(true);

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const result = extractEdgeColorFromMedia(canvas, {
      cacheKey: 'https://giphy.example/x.gif',
    });
    expect(result.source).toBe('fallback');
    expect(result.corsFailed).toBe(true);
    expect(result.hex.toUpperCase()).toBe('#FDC216');
  });

  it('returns fallback when media has no dimensions', () => {
    const img = document.createElement('img');
    const result = extractEdgeColorFromMedia(img, { cacheKey: 'empty' });
    expect(result.source).toBe('fallback');
    expect(result.hex.toUpperCase()).toBe('#FDC216');
  });
});

describe('cache caps', () => {
  beforeEach(() => {
    clearAmbientColorCaches();
  });

  it('evicts oldest entries beyond maxCacheEntries', () => {
    const max = 3;
    for (let i = 0; i < 5; i++) {
      rememberAmbientColor(`k${i}`, { r: i, g: 0, b: 0 }, max);
    }
    expect(getAmbientColorCacheSize()).toBe(3);
    expect(recallAmbientColor('k0')).toBeNull();
    expect(recallAmbientColor('k1')).toBeNull();
    expect(recallAmbientColor('k4')).toEqual({ r: 4, g: 0, b: 0 });
  });
});

describe('reduced-motion helpers', () => {
  it('prefersReducedMotion reads matchMedia and maps to sustained-only', () => {
    const matchMedia = ((query: string) => ({
      matches: true,
      media: query,
    })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion(matchMedia)).toBe(true);
    expect(resolveAmbientMotionMode(true)).toBe('sustained-only');
    expect(resolveAmbientMotionMode(false)).toBe('full');
  });
});
