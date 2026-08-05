/**
 * Centralized ambient media glow configuration (JSON-compatible values).
 * Used by edge-color extraction and AmbientGlowMedia; keep values here — do not scatter.
 */

export type AmbientRgb = {
  r: number;
  g: number;
  b: number;
  hex: string;
};

export type AmbientMediaEffectsConfig = {
  enabled: boolean;
  style: 'edge-matched-ambient';
  fallbackColor: AmbientRgb;
  colorDetection: {
    source: 'visible-edge-pixels';
    canvasSize: number;
    edgeInsetRatio: number;
    minimumAlpha: number;
    excludeNearBlackBelow: number;
    excludeNearWhiteAbove: number;
    preferSaturatedColors: boolean;
    minimumPreferredSaturation: number;
    sampleStaticOnLoad: boolean;
    sampleMovingMediaFps: number;
    fallbackOnCorsError: boolean;
    pauseWhenOffscreen: boolean;
    pauseWhenDocumentHidden: boolean;
    /** Cap for in-memory color-result cache (URLs / keys only — never media binaries). */
    maxCacheEntries: number;
    smoothing: {
      method: 'exponential-moving-average';
      alpha: number;
    };
  };
  sustainedGlow: {
    level: 'MEDIUM';
    primaryBlur: number;
    primaryOpacity: number;
    secondaryBlur: number;
    secondaryOpacity: number;
    radialOpacity: number;
    borderOpacity: number;
  };
  motionGlow: {
    level: 'HIGH';
    animation: 'gentle-breathe';
    durationMs: number;
    maximumScale: number;
  };
  brightFlash: {
    level: 'HIGH';
    primaryBlur: number;
    primaryOpacity: number;
    secondaryBlur: number;
    secondaryOpacity: number;
    radialOpacity: number;
    borderOpacity: number;
    durationMs: number;
    iterationCount: number;
    allowRapidRestart: boolean;
  };
  accessibility: {
    respectPrefersReducedMotion: boolean;
    reducedMotionMode: 'sustained-only';
    neverUseColorAsOnlyStateIndicator: boolean;
  };
};

export const AMBIENT_FALLBACK_HEX = '#FDC216';

export const ambientMediaEffects: AmbientMediaEffectsConfig = {
  enabled: true,
  style: 'edge-matched-ambient',
  fallbackColor: {
    r: 253,
    g: 194,
    b: 22,
    hex: AMBIENT_FALLBACK_HEX,
  },
  colorDetection: {
    source: 'visible-edge-pixels',
    canvasSize: 48,
    edgeInsetRatio: 0.15,
    minimumAlpha: 48,
    excludeNearBlackBelow: 20,
    excludeNearWhiteAbove: 242,
    preferSaturatedColors: true,
    minimumPreferredSaturation: 0.18,
    sampleStaticOnLoad: true,
    sampleMovingMediaFps: 4,
    fallbackOnCorsError: true,
    pauseWhenOffscreen: true,
    pauseWhenDocumentHidden: true,
    maxCacheEntries: 64,
    smoothing: {
      method: 'exponential-moving-average',
      alpha: 0.18,
    },
  },
  sustainedGlow: {
    level: 'MEDIUM',
    primaryBlur: 20,
    primaryOpacity: 0.25,
    secondaryBlur: 60,
    secondaryOpacity: 0.1,
    radialOpacity: 0.25,
    borderOpacity: 0.35,
  },
  motionGlow: {
    level: 'HIGH',
    animation: 'gentle-breathe',
    durationMs: 1450,
    maximumScale: 1.01,
  },
  brightFlash: {
    level: 'HIGH',
    primaryBlur: 40,
    primaryOpacity: 0.6,
    secondaryBlur: 80,
    secondaryOpacity: 0.25,
    radialOpacity: 0.5,
    borderOpacity: 0.7,
    durationMs: 560,
    iterationCount: 1,
    allowRapidRestart: false,
  },
  accessibility: {
    respectPrefersReducedMotion: true,
    reducedMotionMode: 'sustained-only',
    neverUseColorAsOnlyStateIndicator: true,
  },
};

export default ambientMediaEffects;
