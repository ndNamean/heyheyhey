/**
 * Canvas 2D analogue of fragment.glsl (Codrops atmospheric background).
 * Consumes already-interpolated mood hexes — never samples image pixels.
 */

import {
  HEY_PELO_FALLBACK_MOOD,
  type GalleryMood,
} from './communityGalleryMoods';
import { lerpColor, lerpNumber, parseMoodHex, type Rgb255 } from './moodController';

export const ATMOSPHERE_TIME_SCALE = 0.00028;
export const ATMOSPHERE_BLOB_SOFTEN = 0.35;
export const ATMOSPHERE_VELOCITY_LIFT = 0.1;
export const ATMOSPHERE_BASE_BLOB_RADIUS = 0.65;
export const ATMOSPHERE_SECONDARY_BLOB_RADIUS_RATIO = 0.78;
export const ATMOSPHERE_BASE_BLOB_STRENGTH = 0.9;
export const ATMOSPHERE_NOISE_STRENGTH = 0.04;
export const ATMOSPHERE_DEPTH_TO_RADIUS = 0.08;
export const ATMOSPHERE_VELOCITY_TO_STRENGTH = 0.1;
export const ATMOSPHERE_MOTION_SMOOTHING = 0.1;
export const ATMOSPHERE_BUFFER_WIDTH = 96;

export type Rgb01 = { r: number; g: number; b: number };

export type AtmosphereUniforms = {
  uBackgroundColor: Rgb01;
  uBlob1Color: Rgb01;
  uBlob2Color: Rgb01;
  uTime: number;
  uVelocityIntensity: number;
  uNoiseStrength: number;
  uBlobRadius: number;
  uBlobRadiusSecondary: number;
  uBlobStrength: number;
};

export type AtmosphereDrawInput = {
  mood?: GalleryMood;
  /** Elapsed time in the same units as the GLSL uTime uniform (ms). */
  uTime?: number;
  /** 0..1 scroll-speed intensity. */
  uVelocityIntensity?: number;
  depthProgress?: number;
  reducedMotion?: boolean;
  noiseStrength?: number;
};

export type Vec2 = { x: number; y: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rgb255To01(rgb: Rgb255): Rgb01 {
  return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 };
}

function hexToRgb01(hex: string, fallback: Rgb01): Rgb01 {
  const parsed = parseMoodHex(hex);
  return parsed ? rgb255To01(parsed) : fallback;
}

function moodToRgb(mood: GalleryMood): {
  background: Rgb01;
  blob1: Rgb01;
  blob2: Rgb01;
} {
  const background = hexToRgb01(mood.backgroundColor, { r: 1, g: 250 / 255, b: 240 / 255 });
  return {
    background,
    blob1: hexToRgb01(mood.blob1Color, background),
    blob2: hexToRgb01(mood.blob2Color, background),
  };
}

/** GLSL fract */
function fract(value: number): number {
  return value - Math.floor(value);
}

/** GLSL mix */
function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** GLSL smoothstep */
export function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const denom = edge1 - edge0;
  const t = denom === 0 ? (x < edge0 ? 0 : 1) : clamp01((x - edge0) / denom);
  return t * t * (3 - 2 * t);
}

/** GLSL random() from fragment.glsl */
export function shaderRandom(x: number, y: number): number {
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123);
}

export function blobCenters(animTime: number): { blob1: Vec2; blob2: Vec2 } {
  return {
    blob1: {
      x: 0.5 + Math.sin(animTime * 1.0) * 0.13 + Math.sin(animTime * 1.618) * 0.05,
      y: 0.48 + Math.cos(animTime * 0.794) * 0.09 + Math.cos(animTime * 1.272) * 0.03,
    },
    blob2: {
      x: 0.35 + Math.cos(animTime * 0.927) * 0.11 + Math.cos(animTime * 1.414) * 0.04,
      y: 0.55 + Math.sin(animTime * 1.175) * 0.07 + Math.sin(animTime * 0.618) * 0.03,
    },
  };
}

export function sampleAtmosphere(u: number, v: number, uniforms: AtmosphereUniforms): Rgb01 {
  const animTime = uniforms.uTime * ATMOSPHERE_TIME_SCALE;
  const { blob1: c1, blob2: c2 } = blobCenters(animTime);

  let r = uniforms.uBackgroundColor.r;
  let g = uniforms.uBackgroundColor.g;
  let b = uniforms.uBackgroundColor.b;

  const blob1 = glslSmoothstep(
    uniforms.uBlobRadius,
    0,
    Math.hypot(u - c1.x, v - c1.y),
  );
  const blob2 = glslSmoothstep(
    uniforms.uBlobRadiusSecondary,
    0,
    Math.hypot(u - c2.x, v - c2.y),
  );

  const blob1Soft = {
    r: mix(uniforms.uBlob1Color.r, uniforms.uBackgroundColor.r, ATMOSPHERE_BLOB_SOFTEN),
    g: mix(uniforms.uBlob1Color.g, uniforms.uBackgroundColor.g, ATMOSPHERE_BLOB_SOFTEN),
    b: mix(uniforms.uBlob1Color.b, uniforms.uBackgroundColor.b, ATMOSPHERE_BLOB_SOFTEN),
  };
  const blob2Soft = {
    r: mix(uniforms.uBlob2Color.r, uniforms.uBackgroundColor.r, ATMOSPHERE_BLOB_SOFTEN),
    g: mix(uniforms.uBlob2Color.g, uniforms.uBackgroundColor.g, ATMOSPHERE_BLOB_SOFTEN),
    b: mix(uniforms.uBlob2Color.b, uniforms.uBackgroundColor.b, ATMOSPHERE_BLOB_SOFTEN),
  };

  const w1 = blob1 * uniforms.uBlobStrength;
  r = mix(r, blob1Soft.r, w1);
  g = mix(g, blob1Soft.g, w1);
  b = mix(b, blob1Soft.b, w1);

  const w2 = blob2 * uniforms.uBlobStrength;
  r = mix(r, blob2Soft.r, w2);
  g = mix(g, blob2Soft.g, w2);
  b = mix(b, blob2Soft.b, w2);

  const lift = uniforms.uVelocityIntensity * ATMOSPHERE_VELOCITY_LIFT;
  r += lift;
  g += lift;
  b += lift;

  const grain = shaderRandom(u * 1387.13, v * 947.91) - 0.5;
  const noise = grain * uniforms.uNoiseStrength;
  r = clamp01(r + noise);
  g = clamp01(g + noise);
  b = clamp01(b + noise);

  return { r, g, b };
}

export function cssAtmosphereFallback(
  mood: GalleryMood,
  animTime = 0,
): string {
  const { blob1, blob2 } = blobCenters(animTime);
  const blob1Soft = lerpColor(mood.blob1Color, mood.backgroundColor, ATMOSPHERE_BLOB_SOFTEN);
  const blob2Soft = lerpColor(mood.blob2Color, mood.backgroundColor, ATMOSPHERE_BLOB_SOFTEN);
  const r1 = ATMOSPHERE_BASE_BLOB_RADIUS * 100;
  const r2 = ATMOSPHERE_BASE_BLOB_RADIUS * ATMOSPHERE_SECONDARY_BLOB_RADIUS_RATIO * 100;
  const cssY = (glY: number) => (1 - glY) * 100;
  return [
    `radial-gradient(circle at ${blob1.x * 100}% ${cssY(blob1.y)}%, ${blob1Soft} 0%, transparent ${r1}%)`,
    `radial-gradient(circle at ${blob2.x * 100}% ${cssY(blob2.y)}%, ${blob2Soft} 0%, transparent ${r2}%)`,
    mood.backgroundColor,
  ].join(', ');
}

function createBufferCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

export class AtmosphereCanvas {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private smoothedDepthProgress = 0;
  private smoothedVelocityIntensity = 0;

  attach(canvas: HTMLCanvasElement): boolean {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) {
      this.ctx = null;
      return false;
    }
    this.buffer = createBufferCanvas();
    this.bufferCtx = this.buffer?.getContext('2d', { alpha: false }) ?? null;
    return this.bufferCtx != null;
  }

  /**
   * Paint one frame. Overlay owns rAF; this module does not start a loop.
   * If 2d context is unavailable, returns a CSS radial-gradient fallback.
   */
  draw(input: AtmosphereDrawInput = {}): { usedCanvas: boolean; cssFallback: string } {
    const mood = input.mood ?? HEY_PELO_FALLBACK_MOOD;
    const reducedMotion = Boolean(input.reducedMotion);
    const uTime = reducedMotion ? 0 : (input.uTime ?? 0);
    const targetVelocity = reducedMotion ? 0 : clamp01(input.uVelocityIntensity ?? 0);
    const targetDepth = clamp01(input.depthProgress ?? 0);

    this.smoothedDepthProgress = lerpNumber(
      this.smoothedDepthProgress,
      targetDepth,
      ATMOSPHERE_MOTION_SMOOTHING,
    );
    this.smoothedVelocityIntensity = lerpNumber(
      this.smoothedVelocityIntensity,
      targetVelocity,
      ATMOSPHERE_MOTION_SMOOTHING,
    );

    const blobRadius = clamp01(
      Math.min(
        1,
        Math.max(
          0.05,
          ATMOSPHERE_BASE_BLOB_RADIUS + this.smoothedDepthProgress * ATMOSPHERE_DEPTH_TO_RADIUS,
        ),
      ),
    );
    const blobStrength = clamp01(
      ATMOSPHERE_BASE_BLOB_STRENGTH +
        this.smoothedVelocityIntensity * ATMOSPHERE_VELOCITY_TO_STRENGTH,
    );

    const colors = moodToRgb(mood);
    const uniforms: AtmosphereUniforms = {
      uBackgroundColor: colors.background,
      uBlob1Color: colors.blob1,
      uBlob2Color: colors.blob2,
      uTime,
      uVelocityIntensity: this.smoothedVelocityIntensity,
      uNoiseStrength: input.noiseStrength ?? ATMOSPHERE_NOISE_STRENGTH,
      uBlobRadius: blobRadius,
      uBlobRadiusSecondary: blobRadius * ATMOSPHERE_SECONDARY_BLOB_RADIUS_RATIO,
      uBlobStrength: blobStrength,
    };

    const animTime = uTime * ATMOSPHERE_TIME_SCALE;
    const cssFallback = cssAtmosphereFallback(mood, animTime);

    const ctx = this.ctx;
    const canvas = this.canvas;
    const buffer = this.buffer;
    const bufferCtx = this.bufferCtx;
    if (!ctx || !canvas || !buffer || !bufferCtx || canvas.width <= 0 || canvas.height <= 0) {
      return { usedCanvas: false, cssFallback };
    }

    const aspect = canvas.height / canvas.width;
    const width = ATMOSPHERE_BUFFER_WIDTH;
    const height = Math.max(1, Math.round(ATMOSPHERE_BUFFER_WIDTH * aspect));
    if (buffer.width !== width || buffer.height !== height) {
      buffer.width = width;
      buffer.height = height;
    }

    const imageData = bufferCtx.createImageData(width, height);
    const data = imageData.data;
    for (let y = 0; y < height; y++) {
      const v = 1 - (y + 0.5) / height;
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const color = sampleAtmosphere(u, v, uniforms);
        const i = (y * width + x) * 4;
        data[i] = Math.round(color.r * 255);
        data[i + 1] = Math.round(color.g * 255);
        data[i + 2] = Math.round(color.b * 255);
        data[i + 3] = 255;
      }
    }
    bufferCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    return { usedCanvas: true, cssFallback };
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.buffer = null;
    this.bufferCtx = null;
    this.smoothedDepthProgress = 0;
    this.smoothedVelocityIntensity = 0;
  }
}
