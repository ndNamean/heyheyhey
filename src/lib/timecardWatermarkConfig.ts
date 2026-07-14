import type {
  CameraOptions,
  TimecardBackgroundMode,
  TimecardItems,
  TimecardWatermarkConfig,
  UltimateGradientPreset,
} from '../types';

export const DEFAULT_TIMECARD_ITEMS: TimecardItems = {
  time: true,
  date: true,
  day: true,
  userName: false,
  storeCode: false,
  taskItem: false,
  timestamp: false,
  address: true,
  weather: true,
  photoCode: true,
  gpsAccuracy: false,
};

export const DEFAULT_TIMECARD_WATERMARK_CONFIG: TimecardWatermarkConfig = {
  logoOutside: true,
  backgroundMode: 'gradient',
  gradientPreset: 'cyberpunk',
  cardFadeDirection: 'left_to_right',
  frostedGlassEnabled: true,
  autoResize: true,
  items: { ...DEFAULT_TIMECARD_ITEMS },
};

const GRADIENT_PRESET_VALUES: UltimateGradientPreset[] = [
  'luxury_ceo',
  'cyberpunk',
  'royal_mystique',
  'volcanic_energy',
  'moody_monochrome',
];

const BACKGROUND_MODE_CYCLE: TimecardBackgroundMode[] = ['solid', 'gradient', 'frosted'];

function normalizeItems(raw: Partial<TimecardItems> | undefined): TimecardItems {
  return {
    time: raw?.time ?? DEFAULT_TIMECARD_ITEMS.time,
    date: raw?.date ?? DEFAULT_TIMECARD_ITEMS.date,
    day: raw?.day ?? DEFAULT_TIMECARD_ITEMS.day,
    userName: raw?.userName ?? DEFAULT_TIMECARD_ITEMS.userName,
    storeCode: raw?.storeCode ?? DEFAULT_TIMECARD_ITEMS.storeCode,
    taskItem: raw?.taskItem ?? DEFAULT_TIMECARD_ITEMS.taskItem,
    timestamp: raw?.timestamp ?? DEFAULT_TIMECARD_ITEMS.timestamp,
    address: raw?.address ?? DEFAULT_TIMECARD_ITEMS.address,
    weather: raw?.weather ?? DEFAULT_TIMECARD_ITEMS.weather,
    photoCode: raw?.photoCode ?? DEFAULT_TIMECARD_ITEMS.photoCode,
    gpsAccuracy: raw?.gpsAccuracy ?? DEFAULT_TIMECARD_ITEMS.gpsAccuracy,
  };
}

function normalizeGradientPreset(value: unknown): UltimateGradientPreset {
  if (typeof value === 'string' && GRADIENT_PRESET_VALUES.includes(value as UltimateGradientPreset)) {
    return value as UltimateGradientPreset;
  }
  return DEFAULT_TIMECARD_WATERMARK_CONFIG.gradientPreset;
}

function normalizeBackgroundMode(value: unknown): TimecardBackgroundMode {
  if (value === 'solid' || value === 'gradient' || value === 'frosted') return value;
  if (value === 'off' || value === 'gradient_off') return 'frosted';
  if (value === 'gradient_on' || value === 'on') return 'gradient';
  if (value === 'dark' || value === 'solid_dark') return 'solid';
  return DEFAULT_TIMECARD_WATERMARK_CONFIG.backgroundMode;
}

export function normalizeTimecardConfig(
  raw: Partial<TimecardWatermarkConfig> | undefined | null,
): TimecardWatermarkConfig {
  if (!raw) {
    return {
      ...DEFAULT_TIMECARD_WATERMARK_CONFIG,
      items: { ...DEFAULT_TIMECARD_ITEMS },
    };
  }
  return {
    logoOutside: true,
    backgroundMode: normalizeBackgroundMode(raw.backgroundMode),
    gradientPreset: normalizeGradientPreset(raw.gradientPreset),
    cardFadeDirection: 'left_to_right',
    frostedGlassEnabled: raw.frostedGlassEnabled ?? DEFAULT_TIMECARD_WATERMARK_CONFIG.frostedGlassEnabled,
    autoResize: raw.autoResize ?? DEFAULT_TIMECARD_WATERMARK_CONFIG.autoResize,
    items: normalizeItems(raw.items),
  };
}

export function resetTimecardConfig(): TimecardWatermarkConfig {
  return normalizeTimecardConfig(undefined);
}

export function cycleTimecardBackgroundMode(current: TimecardBackgroundMode): TimecardBackgroundMode {
  const idx = BACKGROUND_MODE_CYCLE.indexOf(current);
  return BACKGROUND_MODE_CYCLE[(idx + 1) % BACKGROUND_MODE_CYCLE.length]!;
}

export function resolveEffectiveTimecardItems(
  config: TimecardWatermarkConfig,
  opts: CameraOptions,
): TimecardItems {
  const items = config.items;
  return {
    ...items,
    weather: items.weather && opts.weatherEnabled,
  };
}

export function resolveTimecardConfig(opts?: CameraOptions): TimecardWatermarkConfig {
  return normalizeTimecardConfig(opts?.timecardConfig);
}
