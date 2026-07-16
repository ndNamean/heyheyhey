/**
 * Canvas composition helpers for profile avatars.
 * Reuses GRADIENT_PRESETS / watermark helpers — no duplicate gradient defs.
 */

import { DEFAULT_LOGOS } from './cameraSettings';
import { loadImageForCanvas } from './proofWatermarkDraw';
import {
  fillRoundedGradientRect,
  fillRoundedSolidRect,
  getGradientPreset,
  GRADIENT_PRESETS,
} from './watermarkGradients';
import type { UltimateGradientPreset } from '../types';

export const AVATAR_CANVAS_SIZE = 512;
export const SOLID_DARK_COLOR = 'rgba(10, 10, 12, 1)';

export type AvatarBackgroundChoice =
  | { kind: 'gradient'; preset: UltimateGradientPreset }
  | { kind: 'solid' }
  | { kind: 'transparent' }
  | { kind: 'best_contrast' };

export function profileInitials(displayName: string, email: string): string {
  const source = (displayName || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return (source[0] ?? '?').toUpperCase();
}

/** Average luminance 0–255 from ImageData (ignores near-transparent pixels). */
export function sampleAverageLuminance(imageData: ImageData): number {
  const { data } = imageData;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a < 16) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }
  return count === 0 ? 128 : sum / count;
}

/**
 * Pick an existing watermark gradient for readable contrast vs portrait brightness.
 * Dark portraits → brighter accents; bright portraits → darker bases.
 */
export function pickBestContrastPreset(avgLuminance: number): UltimateGradientPreset {
  if (avgLuminance < 70) return 'cyberpunk';
  if (avgLuminance < 110) return 'volcanic_energy';
  if (avgLuminance < 150) return 'luxury_ceo';
  if (avgLuminance < 190) return 'royal_mystique';
  return 'moody_monochrome';
}

export function resolveBackgroundChoice(
  choice: AvatarBackgroundChoice,
  avgLuminance: number,
): Exclude<AvatarBackgroundChoice, { kind: 'best_contrast' }> {
  if (choice.kind === 'best_contrast') {
    return { kind: 'gradient', preset: pickBestContrastPreset(avgLuminance) };
  }
  return choice;
}

/** Fraction of opaque-ish pixels in the right third of the canvas. */
export function rightThirdOccupancy(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const startX = Math.floor(width * (2 / 3));
  let opaque = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = startX; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] ?? 0;
      total++;
      if (a > 40) opaque++;
    }
  }
  return total === 0 ? 0 : opaque / total;
}

export interface ComposeAvatarOptions {
  portrait: HTMLImageElement | HTMLCanvasElement;
  background: Exclude<AvatarBackgroundChoice, { kind: 'best_contrast' }>;
  logoEnabled: boolean;
  logoUrl?: string;
  size?: number;
}

export async function composeAvatarCanvas(
  opts: ComposeAvatarOptions,
): Promise<HTMLCanvasElement> {
  const size = opts.size ?? AVATAR_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Background fill (full square)
  if (opts.background.kind === 'gradient') {
    fillRoundedGradientRect(ctx, 0, 0, size, size, 0, opts.background.preset);
  } else if (opts.background.kind === 'solid') {
    fillRoundedSolidRect(ctx, 0, 0, size, size, 0, SOLID_DARK_COLOR);
  } else {
    ctx.clearRect(0, 0, size, size);
  }

  // Portrait centered / cover
  drawCoverImage(ctx, opts.portrait, 0, 0, size, size);

  if (opts.logoEnabled) {
    const logoUrl = opts.logoUrl || DEFAULT_LOGOS[0];
    const logoImg = await loadImageForCanvas(logoUrl);
    if (logoImg) {
      // Sample occupancy after portrait for logo shift
      const sample = ctx.getImageData(0, 0, size, size);
      const occupancy = rightThirdOccupancy(sample);
      drawAvatarLogo(ctx, logoImg, size, occupancy);
    }
  }

  return canvas;
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const iw = 'naturalWidth' in img ? img.naturalWidth || img.width : img.width;
  const ih = 'naturalHeight' in img ? img.naturalHeight || img.height : img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawAvatarLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  size: number,
  rightOccupancy: number,
) {
  const maxW = size * 0.22;
  const maxH = size * 0.14;
  const aspect = (logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height || 1);
  let lw = maxW;
  let lh = lw / aspect;
  if (lh > maxH) {
    lh = maxH;
    lw = lh * aspect;
  }

  // Safe margins from right/bottom; shift left if person occupies right side
  const margin = size * 0.06;
  let busyShift = 0;
  if (rightOccupancy > 0.35) {
    busyShift = size * 0.12;
    // Slightly shrink when crowded
    lw *= 0.9;
    lh *= 0.9;
  }

  const x = size - margin - lw - busyShift;
  const y = size - margin - lh;

  ctx.save();
  // Subtle shadow only when needed for readability on busy right side
  if (rightOccupancy > 0.25) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = size * 0.02;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = size * 0.004;
  }
  ctx.drawImage(logo, x, y, lw, lh);
  ctx.restore();
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
      'image/png',
    );
  });
}

export function loadFileAsImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

export { GRADIENT_PRESETS, getGradientPreset };
