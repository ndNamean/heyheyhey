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
