import {
  ambientMediaEffects,
  type AmbientMediaEffectsConfig,
  type AmbientRgb,
} from '../config/ambientMediaEffects';

export type Rgb = { r: number; g: number; b: number };

export type EdgeColorResult = {
  color: Rgb;
  hex: string;
  source: 'extracted' | 'fallback' | 'cache';
  corsFailed: boolean;
};

export type ColorDetectionOptions = AmbientMediaEffectsConfig['colorDetection'];

type PixelFilters = Pick<
  ColorDetectionOptions,
  | 'minimumAlpha'
  | 'excludeNearBlackBelow'
  | 'excludeNearWhiteAbove'
  | 'preferSaturatedColors'
  | 'minimumPreferredSaturation'
>;

const DEFAULT_DETECTION = ambientMediaEffects.colorDetection;
const FALLBACK: AmbientRgb = ambientMediaEffects.fallbackColor;

/** Module-level caches — color results and permanent CORS failures only (no binaries). */
const colorCache = new Map<string, Rgb>();
const corsFailureKeys = new Set<string>();
let cacheOrder: string[] = [];

export function clearAmbientColorCaches(): void {
  colorCache.clear();
  corsFailureKeys.clear();
  cacheOrder = [];
}

export function getAmbientColorCacheSize(): number {
  return colorCache.size;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length !== 6 || Number.isNaN(parseInt(normalized, 16))) {
    return { r: FALLBACK.r, g: FALLBACK.g, b: FALLBACK.b };
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

export function fallbackAmbientColor(): Rgb {
  return { r: FALLBACK.r, g: FALLBACK.g, b: FALLBACK.b };
}

/**
 * HSL saturation in [0, 1] — used to prefer vivid edge colors.
 */
export function pixelSaturation(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  const light = (max + min) / 2;
  return delta / (1 - Math.abs(2 * light - 1));
}

export function shouldExcludePixel(
  r: number,
  g: number,
  b: number,
  a: number,
  filters: PixelFilters = DEFAULT_DETECTION,
): boolean {
  if (a < filters.minimumAlpha) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= filters.excludeNearBlackBelow) return true;
  if (min >= filters.excludeNearWhiteAbove) return true;
  return false;
}

function isEdgePixel(x: number, y: number, width: number, height: number, insetRatio: number): boolean {
  const insetX = Math.max(1, Math.floor(width * insetRatio));
  const insetY = Math.max(1, Math.floor(height * insetRatio));
  return x < insetX || x >= width - insetX || y < insetY || y >= height - insetY;
}

type Cluster = { r: number; g: number; b: number; weight: number; satSum: number };

function quantizeChannel(v: number, steps = 8): number {
  const step = 256 / steps;
  return Math.min(255, Math.floor(v / step) * step + step / 2);
}

/**
 * Sample edge pixels from ImageData, exclude alpha/near-black/near-white,
 * prefer saturated clusters, return strongest edge color or null.
 */
export function extractEdgeColorFromImageData(
  imageData: ImageData,
  options: Partial<ColorDetectionOptions> = {},
): Rgb | null {
  const opts = { ...DEFAULT_DETECTION, ...options };
  const { width, height, data } = imageData;
  if (width < 1 || height < 1) return null;

  const clusters = new Map<string, Cluster>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isEdgePixel(x, y, width, height, opts.edgeInsetRatio)) continue;
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (shouldExcludePixel(r, g, b, a, opts)) continue;

      const sat = pixelSaturation(r, g, b);
      if (opts.preferSaturatedColors && sat < opts.minimumPreferredSaturation) {
        // Still allow low-sat pixels but with reduced weight so vivid colors win.
      }
      const qr = quantizeChannel(r);
      const qg = quantizeChannel(g);
      const qb = quantizeChannel(b);
      const key = `${qr},${qg},${qb}`;
      const satWeight = opts.preferSaturatedColors
        ? 0.35 + Math.max(sat, opts.minimumPreferredSaturation)
        : 1;
      const weight = satWeight * (a / 255);
      const existing = clusters.get(key);
      if (existing) {
        existing.r += r * weight;
        existing.g += g * weight;
        existing.b += b * weight;
        existing.weight += weight;
        existing.satSum += sat * weight;
      } else {
        clusters.set(key, {
          r: r * weight,
          g: g * weight,
          b: b * weight,
          weight,
          satSum: sat * weight,
        });
      }
    }
  }

  if (clusters.size === 0) return null;

  let best: Cluster | null = null;
  let bestScore = -1;
  for (const cluster of clusters.values()) {
    const avgSat = cluster.satSum / cluster.weight;
    const satBoost =
      opts.preferSaturatedColors && avgSat >= opts.minimumPreferredSaturation ? 1.35 : 1;
    const score = cluster.weight * satBoost;
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }

  if (!best || best.weight <= 0) return null;
  return {
    r: Math.round(best.r / best.weight),
    g: Math.round(best.g / best.weight),
    b: Math.round(best.b / best.weight),
  };
}

/** Exponential moving average toward `next` with given alpha in (0, 1]. */
export function smoothColorEma(prev: Rgb | null, next: Rgb, alpha: number = DEFAULT_DETECTION.smoothing.alpha): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  if (!prev || a >= 1) return { ...next };
  return {
    r: prev.r + (next.r - prev.r) * a,
    g: prev.g + (next.g - prev.g) * a,
    b: prev.b + (next.b - prev.b) * a,
  };
}

function touchCacheKey(key: string, maxEntries: number): void {
  const idx = cacheOrder.indexOf(key);
  if (idx >= 0) cacheOrder.splice(idx, 1);
  cacheOrder.push(key);
  while (cacheOrder.length > maxEntries) {
    const evict = cacheOrder.shift();
    if (evict) colorCache.delete(evict);
  }
}

export function rememberAmbientColor(
  key: string,
  color: Rgb,
  maxEntries: number = DEFAULT_DETECTION.maxCacheEntries,
): void {
  colorCache.set(key, { ...color });
  touchCacheKey(key, maxEntries);
}

export function recallAmbientColor(key: string): Rgb | null {
  const hit = colorCache.get(key);
  if (!hit) return null;
  touchCacheKey(key, DEFAULT_DETECTION.maxCacheEntries);
  return { ...hit };
}

export function markCorsFailure(key: string): void {
  corsFailureKeys.add(key);
}

export function hasCorsFailure(key: string): boolean {
  return corsFailureKeys.has(key);
}

export type SampleableMedia = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function mediaNaturalSize(media: SampleableMedia): { w: number; h: number } {
  if (media instanceof HTMLVideoElement) {
    return { w: media.videoWidth || 0, h: media.videoHeight || 0 };
  }
  if (media instanceof HTMLCanvasElement) {
    return { w: media.width, h: media.height };
  }
  return {
    w: media.naturalWidth || media.width || 0,
    h: media.naturalHeight || media.height || 0,
  };
}

/**
 * Draw media to a reduced canvas and extract edge color.
 * On SecurityError / CORS failure: mark key (if provided), return fallback, no retry loops.
 */
export function extractEdgeColorFromMedia(
  media: SampleableMedia,
  options: {
    cacheKey?: string;
    detection?: Partial<ColorDetectionOptions>;
    previousColor?: Rgb | null;
    applySmoothing?: boolean;
  } = {},
): EdgeColorResult {
  const detection = { ...DEFAULT_DETECTION, ...options.detection };
  const cacheKey = options.cacheKey;

  if (cacheKey && hasCorsFailure(cacheKey)) {
    const cached = recallAmbientColor(cacheKey);
    if (cached) {
      return { color: cached, hex: rgbToHex(cached), source: 'cache', corsFailed: true };
    }
    const fb = fallbackAmbientColor();
    return { color: fb, hex: FALLBACK.hex, source: 'fallback', corsFailed: true };
  }

  const { w, h } = mediaNaturalSize(media);
  if (w < 1 || h < 1) {
    const fb = fallbackAmbientColor();
    return { color: fb, hex: FALLBACK.hex, source: 'fallback', corsFailed: false };
  }

  if (typeof document === 'undefined') {
    const fb = fallbackAmbientColor();
    return { color: fb, hex: FALLBACK.hex, source: 'fallback', corsFailed: false };
  }

  const size = detection.canvasSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    const fb = fallbackAmbientColor();
    return { color: fb, hex: FALLBACK.hex, source: 'fallback', corsFailed: false };
  }

  try {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(media, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    let extracted = extractEdgeColorFromImageData(imageData, detection);
    if (!extracted) {
      const fb = fallbackAmbientColor();
      return { color: fb, hex: FALLBACK.hex, source: 'fallback', corsFailed: false };
    }

    if (options.applySmoothing !== false) {
      extracted = smoothColorEma(options.previousColor ?? null, extracted, detection.smoothing.alpha);
    }

    const rounded: Rgb = {
      r: Math.round(extracted.r),
      g: Math.round(extracted.g),
      b: Math.round(extracted.b),
    };

    if (cacheKey) {
      rememberAmbientColor(cacheKey, rounded, detection.maxCacheEntries);
    }

    return { color: rounded, hex: rgbToHex(rounded), source: 'extracted', corsFailed: false };
  } catch {
    if (detection.fallbackOnCorsError && cacheKey) {
      markCorsFailure(cacheKey);
    }
    const fb = fallbackAmbientColor();
    return {
      color: fb,
      hex: FALLBACK.hex,
      source: 'fallback',
      corsFailed: true,
    };
  }
}

export function prefersReducedMotion(matchMediaFn: typeof window.matchMedia | undefined = typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined): boolean {
  if (!ambientMediaEffects.accessibility.respectPrefersReducedMotion) return false;
  try {
    return Boolean(matchMediaFn?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Reduced-motion ⇒ sustained glow only (no breathe / flash). */
export function resolveAmbientMotionMode(reducedMotion: boolean): 'sustained-only' | 'full' {
  if (reducedMotion && ambientMediaEffects.accessibility.reducedMotionMode === 'sustained-only') {
    return 'sustained-only';
  }
  return 'full';
}

export function ambientColorCssVars(color: Rgb): Record<string, string> {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  const s = ambientMediaEffects.sustainedGlow;
  const f = ambientMediaEffects.brightFlash;
  return {
    '--ambient-r': String(r),
    '--ambient-g': String(g),
    '--ambient-b': String(b),
    '--ambient-glow-primary': `0 0 ${s.primaryBlur}px rgba(${r}, ${g}, ${b}, ${s.primaryOpacity})`,
    '--ambient-glow-secondary': `0 0 ${s.secondaryBlur}px rgba(${r}, ${g}, ${b}, ${s.secondaryOpacity})`,
    '--ambient-radial': `rgba(${r}, ${g}, ${b}, ${s.radialOpacity})`,
    '--ambient-border': `1px solid rgba(${r}, ${g}, ${b}, ${s.borderOpacity})`,
    '--ambient-flash-primary': `0 0 ${f.primaryBlur}px rgba(${r}, ${g}, ${b}, ${f.primaryOpacity})`,
    '--ambient-flash-secondary': `0 0 ${f.secondaryBlur}px rgba(${r}, ${g}, ${b}, ${f.secondaryOpacity})`,
    '--ambient-flash-radial': `rgba(${r}, ${g}, ${b}, ${f.radialOpacity})`,
    '--ambient-flash-border': `1px solid rgba(${r}, ${g}, ${b}, ${f.borderOpacity})`,
    '--ambient-breathe-duration': `${ambientMediaEffects.motionGlow.durationMs}ms`,
    '--ambient-breathe-scale': String(ambientMediaEffects.motionGlow.maximumScale),
    '--ambient-flash-duration': `${f.durationMs}ms`,
  };
}
