import type {
  CameraOptions,
  UltimateBoxItems,
  UltimateGradientPreset,
  UltimateLayoutMode,
  UltimateWatermarkConfig,
} from '../types';

export const DEFAULT_ULTIMATE_BOX_ITEMS: UltimateBoxItems = {
  logo: true,
  userName: true,
  storeCode: true,
  taskItem: true,
  timestamp: true,
  address: false,
  weather: false,
};

export const DEFAULT_ULTIMATE_WATERMARK_CONFIG: UltimateWatermarkConfig = {
  boxEnabled: true,
  boxGradientEnabled: true,
  boxGradientPreset: 'cyberpunk',
  boxItems: { ...DEFAULT_ULTIMATE_BOX_ITEMS },
  layoutMode: 'logo_dock',
  autoResize: true,
};

const GRADIENT_PRESET_VALUES: UltimateGradientPreset[] = [
  'luxury_ceo',
  'cyberpunk',
  'royal_mystique',
  'volcanic_energy',
  'moody_monochrome',
];

const LAYOUT_MODE_VALUES: UltimateLayoutMode[] = ['strip', 'logo_dock'];

function normalizeBoxItems(raw: Partial<UltimateBoxItems> | undefined): UltimateBoxItems {
  return {
    logo: raw?.logo ?? DEFAULT_ULTIMATE_BOX_ITEMS.logo,
    userName: raw?.userName ?? DEFAULT_ULTIMATE_BOX_ITEMS.userName,
    storeCode: raw?.storeCode ?? DEFAULT_ULTIMATE_BOX_ITEMS.storeCode,
    taskItem: raw?.taskItem ?? DEFAULT_ULTIMATE_BOX_ITEMS.taskItem,
    timestamp: raw?.timestamp ?? DEFAULT_ULTIMATE_BOX_ITEMS.timestamp,
    address: raw?.address ?? DEFAULT_ULTIMATE_BOX_ITEMS.address,
    weather: raw?.weather ?? DEFAULT_ULTIMATE_BOX_ITEMS.weather,
  };
}

function normalizeGradientPreset(value: unknown): UltimateGradientPreset {
  if (typeof value === 'string' && GRADIENT_PRESET_VALUES.includes(value as UltimateGradientPreset)) {
    return value as UltimateGradientPreset;
  }
  return DEFAULT_ULTIMATE_WATERMARK_CONFIG.boxGradientPreset;
}

function normalizeLayoutMode(value: unknown): UltimateLayoutMode {
  if (value === 'strip' || value === 'logo_dock') return value;
  if (value === 'logoDock') return 'logo_dock';
  return DEFAULT_ULTIMATE_WATERMARK_CONFIG.layoutMode;
}

export function normalizeUltimateConfig(
  raw: Partial<UltimateWatermarkConfig> | undefined | null,
): UltimateWatermarkConfig {
  if (!raw) return { ...DEFAULT_ULTIMATE_WATERMARK_CONFIG, boxItems: { ...DEFAULT_ULTIMATE_BOX_ITEMS } };
  return {
    boxEnabled: raw.boxEnabled ?? DEFAULT_ULTIMATE_WATERMARK_CONFIG.boxEnabled,
    boxGradientEnabled:
      raw.boxGradientEnabled ?? DEFAULT_ULTIMATE_WATERMARK_CONFIG.boxGradientEnabled,
    boxGradientPreset: normalizeGradientPreset(raw.boxGradientPreset),
    boxItems: normalizeBoxItems(raw.boxItems),
    layoutMode: normalizeLayoutMode(raw.layoutMode),
    autoResize: raw.autoResize ?? DEFAULT_ULTIMATE_WATERMARK_CONFIG.autoResize,
  };
}

export function resetUltimateConfig(): UltimateWatermarkConfig {
  return normalizeUltimateConfig(undefined);
}

export function resolveEffectiveBoxItems(
  config: UltimateWatermarkConfig,
  opts: CameraOptions,
): UltimateBoxItems {
  const items = config.boxItems;
  return {
    logo: items.logo && opts.logoEnabled,
    userName: items.userName,
    storeCode: items.storeCode,
    taskItem: items.taskItem,
    timestamp: items.timestamp,
    address: items.address,
    weather: items.weather && opts.weatherEnabled,
  };
}

export function deriveFloatingItems(boxItems: UltimateBoxItems): UltimateBoxItems {
  return {
    logo: !boxItems.logo,
    userName: !boxItems.userName,
    storeCode: !boxItems.storeCode,
    taskItem: !boxItems.taskItem,
    timestamp: !boxItems.timestamp,
    address: !boxItems.address,
    weather: !boxItems.weather,
  };
}

export function resolveUltimateConfig(opts?: CameraOptions): UltimateWatermarkConfig {
  return normalizeUltimateConfig(opts?.watermarkConfig);
}
