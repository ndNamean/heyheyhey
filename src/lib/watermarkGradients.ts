import type { UltimateGradientPreset } from '../types';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface GradientPresetDef {
  key: UltimateGradientPreset;
  labelKey: string;
  stops: GradientStop[];
}

export const GRADIENT_PRESETS: GradientPresetDef[] = [
  {
    key: 'luxury_ceo',
    labelKey: 'gradientLuxuryCeo',
    stops: [
      { offset: 0, color: '#0a0a0a' },
      { offset: 0.55, color: '#553c00' },
      { offset: 1, color: '#d4af37' },
    ],
  },
  {
    key: 'cyberpunk',
    labelKey: 'gradientCyberpunk',
    stops: [
      { offset: 0, color: '#0b0b0b' },
      { offset: 1, color: '#00f2fe' },
    ],
  },
  {
    key: 'royal_mystique',
    labelKey: 'gradientRoyalMystique',
    stops: [
      { offset: 0, color: '#0a0a0a' },
      { offset: 0.5, color: '#6a3093' },
      { offset: 1, color: '#a044ff' },
    ],
  },
  {
    key: 'volcanic_energy',
    labelKey: 'gradientVolcanicEnergy',
    stops: [
      { offset: 0, color: '#0c0c0c' },
      { offset: 1, color: '#e65c00' },
    ],
  },
  {
    key: 'moody_monochrome',
    labelKey: 'gradientMoodyMonochrome',
    stops: [
      { offset: 0, color: '#0a0a0a' },
      { offset: 0.5, color: '#2c2c2c' },
      { offset: 1, color: '#6b6b6b' },
    ],
  },
];

export function getGradientPreset(preset: UltimateGradientPreset): GradientPresetDef {
  return GRADIENT_PRESETS.find((p) => p.key === preset) ?? GRADIENT_PRESETS[1]!;
}

export function resolveGradientCss(preset: UltimateGradientPreset): string {
  const def = getGradientPreset(preset);
  const stops = def.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
  return `linear-gradient(135deg, ${stops})`;
}

function fillRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function fillRoundedGradientRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  preset: UltimateGradientPreset,
) {
  const def = getGradientPreset(preset);
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  for (const stop of def.stops) {
    grad.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = grad;
  fillRoundedRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
}

export function fillRoundedSolidRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color = 'rgba(0,0,0,0.72)',
) {
  ctx.fillStyle = color;
  fillRoundedRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
}

/** Soft left→right dissolve mask applied after painting a card face. */
export function applyLeftToRightFadeMask(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(x, y, x + w, y);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.45, 'rgba(0,0,0,0.92)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0.45)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function fillRoundedFrostedFadeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, 'rgba(210, 212, 218, 0.78)');
  grad.addColorStop(0.4, 'rgba(190, 193, 200, 0.48)');
  grad.addColorStop(0.75, 'rgba(170, 174, 182, 0.18)');
  grad.addColorStop(1, 'rgba(150, 154, 162, 0.02)');
  ctx.fillStyle = grad;
  fillRoundedRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
}

/**
 * Draw a rounded card face into an offscreen buffer, then apply a left→right dissolve,
 * then paint onto the destination with a soft shadow.
 */
export function drawFadingCardFace(
  dest: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  if (w <= 0 || h <= 0) return;
  const buf = document.createElement('canvas');
  buf.width = Math.ceil(w);
  buf.height = Math.ceil(h);
  const bctx = buf.getContext('2d');
  if (!bctx) return;

  paint(bctx);
  applyLeftToRightFadeMask(bctx, 0, 0, w, h);

  dest.save();
  dest.shadowColor = 'rgba(0, 0, 0, 0.38)';
  dest.shadowBlur = Math.max(8, Math.round(Math.min(w, h) * 0.08));
  dest.shadowOffsetX = 0;
  dest.shadowOffsetY = Math.max(2, Math.round(h * 0.04));
  dest.drawImage(buf, x, y);
  dest.restore();
}
