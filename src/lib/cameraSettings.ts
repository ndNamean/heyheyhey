import type { CameraOptions, Profile, ProofWeather, Store, WatermarkStyle } from '../types';

export const DEFAULT_LOGOS = [
  'https://www.heypelo.com/wp-content/uploads/2025/10/cropped-heypelonegatif.png',
  'https://www.heypelo.com/wp-content/uploads/2025/10/Sans-titre-6-01.png',
] as const;

export const DEFAULT_CAMERA_OPTIONS: CameraOptions = {
  weatherEnabled: true,
  logoEnabled: true,
  flashlightLastUsed: false,
  watermarkStyle: 'blackBoxInline',
};

const WATERMARK_STYLE_CYCLE: WatermarkStyle[] = [
  'blackBox',
  'transparentFloating',
  'logoDock',
  'blackBoxInline',
];

function normalizeWatermarkStyle(value: unknown): WatermarkStyle {
  if (value === 'transparentFloating' || value === 'floating') return 'transparentFloating';
  if (value === 'logoDock' || value === 'logo_dock') return 'logoDock';
  if (value === 'blackBoxInline' || value === 'proof_strip') return 'blackBoxInline';
  if (value === 'blackBox' || value === 'black_box') return 'blackBox';
  return 'blackBox';
}

export function watermarkStyleLabel(
  style: WatermarkStyle,
  labels: { blackBox: string; floating: string; logoDock: string; proofStrip: string },
): string {
  switch (style) {
    case 'transparentFloating':
      return labels.floating;
    case 'logoDock':
      return labels.logoDock;
    case 'blackBoxInline':
      return labels.proofStrip;
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

export function parseCameraOptions(profile: Profile | null | undefined): CameraOptions {
  const raw = profile?.cameraOptionsJson?.trim();
  if (!raw) return { ...DEFAULT_CAMERA_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as Partial<CameraOptions>;
    return {
      weatherEnabled: parsed.weatherEnabled ?? true,
      logoEnabled: parsed.logoEnabled ?? true,
      flashlightLastUsed: parsed.flashlightLastUsed ?? false,
      watermarkStyle: normalizeWatermarkStyle(parsed.watermarkStyle),
    };
  } catch {
    return { ...DEFAULT_CAMERA_OPTIONS };
  }
}

export function serializeCameraOptions(opts: CameraOptions): string {
  return JSON.stringify(opts);
}

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
  return role === 'owner' || role === 'areaManager';
}
