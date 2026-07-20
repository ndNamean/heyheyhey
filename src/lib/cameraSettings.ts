import type {
  CameraOptions,
  Profile,
  ProofWeather,
  Store,
  WatermarkDirection,
  WatermarkStyle,
} from '../types';
import {
  DEFAULT_ULTIMATE_WATERMARK_CONFIG,
  normalizeUltimateConfig,
  resetUltimateConfig,
} from './ultimateWatermarkConfig';
import {
  DEFAULT_TIMECARD_WATERMARK_CONFIG,
  normalizeTimecardConfig,
  resetTimecardConfig,
} from './timecardWatermarkConfig';

export const DEFAULT_LOGOS = [
  'https://www.heypelo.com/wp-content/uploads/2025/10/cropped-heypelonegatif.png',
  'https://www.heypelo.com/wp-content/uploads/2025/10/Sans-titre-6-01.png',
] as const;

export const DEFAULT_CAMERA_OPTIONS: CameraOptions = {
  weatherEnabled: true,
  logoEnabled: true,
  flashlightLastUsed: false,
  watermarkStyle: 'blackBoxInline',
  watermarkDirection: 0,
};

export function normalizeWatermarkDirection(value: unknown): WatermarkDirection {
  const n = typeof value === 'number' ? value : Number(value);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

const WATERMARK_STYLE_CYCLE: WatermarkStyle[] = [
  'blackBox',
  'transparentFloating',
  'logoDock',
  'blackBoxInline',
  'ultimate_custom',
  'timecard_stamp',
];

function normalizeWatermarkStyle(value: unknown): WatermarkStyle {
  if (value === 'transparentFloating' || value === 'floating') return 'transparentFloating';
  if (value === 'logoDock' || value === 'logo_dock') return 'logoDock';
  if (value === 'blackBoxInline' || value === 'proof_strip') return 'blackBoxInline';
  if (value === 'ultimate_custom' || value === 'ultimate') return 'ultimate_custom';
  if (value === 'timecard_stamp' || value === 'timecard') return 'timecard_stamp';
  if (value === 'blackBox' || value === 'black_box') return 'blackBox';
  return 'blackBox';
}

export function watermarkStyleLabel(
  style: WatermarkStyle,
  labels: {
    blackBox: string;
    floating: string;
    logoDock: string;
    proofStrip: string;
    ultimate: string;
    timecard: string;
  },
): string {
  switch (style) {
    case 'transparentFloating':
      return labels.floating;
    case 'logoDock':
      return labels.logoDock;
    case 'blackBoxInline':
      return labels.proofStrip;
    case 'ultimate_custom':
      return labels.ultimate;
    case 'timecard_stamp':
      return labels.timecard;
    default:
      return labels.blackBox;
  }
}

export function resolveWatermarkStyle(opts?: CameraOptions): WatermarkStyle {
  return normalizeWatermarkStyle(opts?.watermarkStyle);
}

export function cycleWatermarkStyle(current?: WatermarkStyle): WatermarkStyle {
  const resolved = normalizeWatermarkStyle(current);
  const idx = WATERMARK_STYLE_CYCLE.indexOf(resolved);
  return WATERMARK_STYLE_CYCLE[(idx + 1) % WATERMARK_STYLE_CYCLE.length]!;
}

export function ensureUltimateConfig(opts: CameraOptions): CameraOptions {
  if (resolveWatermarkStyle(opts) !== 'ultimate_custom') return opts;
  return {
    ...opts,
    watermarkConfig: normalizeUltimateConfig(opts.watermarkConfig),
  };
}

export function ensureTimecardConfig(opts: CameraOptions): CameraOptions {
  if (resolveWatermarkStyle(opts) !== 'timecard_stamp') return opts;
  return {
    ...opts,
    timecardConfig: normalizeTimecardConfig(opts.timecardConfig),
  };
}

export function ensureWatermarkConfig(opts: CameraOptions): CameraOptions {
  return ensureTimecardConfig(ensureUltimateConfig(opts));
}

export function parseCameraOptions(profile: Profile | null | undefined): CameraOptions {
  const raw = profile?.cameraOptionsJson?.trim();
  if (!raw) return { ...DEFAULT_CAMERA_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as Partial<CameraOptions>;
    const opts: CameraOptions = {
      weatherEnabled: parsed.weatherEnabled ?? true,
      logoEnabled: parsed.logoEnabled ?? true,
      flashlightLastUsed: parsed.flashlightLastUsed ?? false,
      watermarkStyle: normalizeWatermarkStyle(parsed.watermarkStyle),
      watermarkDirection: normalizeWatermarkDirection(parsed.watermarkDirection),
    };
    if (opts.watermarkStyle === 'ultimate_custom') {
      opts.watermarkConfig = normalizeUltimateConfig(parsed.watermarkConfig);
    }
    if (opts.watermarkStyle === 'timecard_stamp') {
      opts.timecardConfig = normalizeTimecardConfig(parsed.timecardConfig);
    }
    return opts;
  } catch {
    return { ...DEFAULT_CAMERA_OPTIONS };
  }
}

export function serializeCameraOptions(opts: CameraOptions): string {
  return JSON.stringify(opts);
}

export {
  resetUltimateConfig,
  DEFAULT_ULTIMATE_WATERMARK_CONFIG,
  normalizeUltimateConfig,
  resetTimecardConfig,
  DEFAULT_TIMECARD_WATERMARK_CONFIG,
  normalizeTimecardConfig,
};

export function resolveActiveLogoUrl(store: Store | null | undefined): string {
  const saved = store?.proofLogoUrl?.trim();
  if (saved) return saved;
  return DEFAULT_LOGOS[0];
}

export function formatWeatherLine(w: ProofWeather | null | undefined): string {
  if (!w) return '';
  const temp = Math.round(w.temperature);
  const condition = w.condition?.trim() || '—';
  const humidity = Math.round(w.humidity);
  const wind = typeof w.windSpeed === 'number' ? w.windSpeed.toFixed(1) : '0.0';
  return `${temp}°C · ${condition} · Humidity ${humidity}% · Wind ${wind} m/s`;
}

export interface WeatherStatusMessages {
  unavailable: string;
  waitingGps: string;
  loading: string;
}

const DEFAULT_WEATHER_STATUS: WeatherStatusMessages = {
  unavailable: 'Weather unavailable',
  waitingGps: 'Weather waiting for GPS...',
  loading: 'Weather loading...',
};

export function buildWeatherLine(
  weatherEnabled: boolean,
  gps: { lat: number; lng: number; accuracy: number } | null,
  gpsError: string | null,
  status: 'waiting' | 'loading' | 'ready' | 'unavailable',
  weather: ProofWeather | null,
  statusMessages: WeatherStatusMessages = DEFAULT_WEATHER_STATUS,
): string {
  if (!weatherEnabled) return '';
  if (gpsError || status === 'unavailable') return statusMessages.unavailable;
  if (!gps || status === 'waiting') return statusMessages.waitingGps;
  if (status === 'loading' || !weather) return statusMessages.loading;
  return formatWeatherLine(weather);
}

export function canEditStoreLogo(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}
