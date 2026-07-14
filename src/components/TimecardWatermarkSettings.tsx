import type {
  CameraOptions,
  TimecardBackgroundMode,
  TimecardItems,
  TimecardWatermarkConfig,
  UltimateGradientPreset,
} from '../types';
import { GRADIENT_PRESETS } from '../lib/watermarkGradients';
import {
  cycleTimecardBackgroundMode,
  resetTimecardConfig,
} from '../lib/timecardWatermarkConfig';

interface Labels {
  cardItems: string;
  backgroundMode: string;
  backgroundSolid: string;
  backgroundGradientOn: string;
  backgroundGradientOff: string;
  resetDefault: string;
  itemTime: string;
  itemDate: string;
  itemDay: string;
  itemUser: string;
  itemStore: string;
  itemTask: string;
  itemTimestamp: string;
  itemAddress: string;
  itemWeather: string;
  itemPhotoCode: string;
  itemGpsAccuracy: string;
  gradientLuxuryCeo: string;
  gradientCyberpunk: string;
  gradientRoyalMystique: string;
  gradientVolcanicEnergy: string;
  gradientMoodyMonochrome: string;
}

interface Props {
  cameraOptions: CameraOptions;
  labels: Labels;
  onSave: (next: CameraOptions) => void;
}

const ITEM_KEYS: Array<{ key: keyof TimecardItems; labelKey: keyof Labels }> = [
  { key: 'time', labelKey: 'itemTime' },
  { key: 'date', labelKey: 'itemDate' },
  { key: 'day', labelKey: 'itemDay' },
  { key: 'userName', labelKey: 'itemUser' },
  { key: 'storeCode', labelKey: 'itemStore' },
  { key: 'taskItem', labelKey: 'itemTask' },
  { key: 'timestamp', labelKey: 'itemTimestamp' },
  { key: 'address', labelKey: 'itemAddress' },
  { key: 'weather', labelKey: 'itemWeather' },
  { key: 'photoCode', labelKey: 'itemPhotoCode' },
  { key: 'gpsAccuracy', labelKey: 'itemGpsAccuracy' },
];

function presetLabel(labels: Labels, labelKey: string): string {
  return labels[labelKey as keyof Labels] ?? labelKey;
}

function backgroundModeLabel(mode: TimecardBackgroundMode, labels: Labels): string {
  if (mode === 'solid') return labels.backgroundSolid;
  if (mode === 'gradient') return labels.backgroundGradientOn;
  return labels.backgroundGradientOff;
}

function patchConfig(
  cameraOptions: CameraOptions,
  patch: Partial<TimecardWatermarkConfig>,
): CameraOptions {
  const current = cameraOptions.timecardConfig ?? resetTimecardConfig();
  return {
    ...cameraOptions,
    timecardConfig: { ...current, ...patch, logoOutside: true },
  };
}

export default function TimecardWatermarkSettings({ cameraOptions, labels, onSave }: Props) {
  const config = cameraOptions.timecardConfig ?? resetTimecardConfig();

  function toggleItem(key: keyof TimecardItems) {
    onSave(
      patchConfig(cameraOptions, {
        items: { ...config.items, [key]: !config.items[key] },
      }),
    );
  }

  function setPreset(preset: UltimateGradientPreset) {
    onSave(patchConfig(cameraOptions, { gradientPreset: preset, backgroundMode: 'gradient' }));
  }

  return (
    <div className="camera-options-ultimate">
      <div className="camera-options-ultimate-section">
        <span className="camera-options-ultimate-label">{labels.cardItems}</span>
        <div className="camera-options-item-grid">
          {ITEM_KEYS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              className={`cam-opt-toggle cam-opt-toggle-sm${config.items[key] ? ' active' : ''}`}
              onClick={() => toggleItem(key)}
            >
              {labels[labelKey]}
            </button>
          ))}
        </div>
      </div>

      <div className="camera-options-row">
        <span>{labels.backgroundMode}</span>
        <button
          type="button"
          className="cam-opt-toggle"
          onClick={() =>
            onSave(
              patchConfig(cameraOptions, {
                backgroundMode: cycleTimecardBackgroundMode(config.backgroundMode),
              }),
            )
          }
        >
          {backgroundModeLabel(config.backgroundMode, labels)}
        </button>
      </div>

      {config.backgroundMode === 'gradient' && (
        <div className="camera-options-ultimate-section">
          <div className="camera-options-preset-row">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`cam-opt-preset${config.gradientPreset === preset.key ? ' active' : ''}`}
                style={{
                  background: `linear-gradient(135deg, ${preset.stops
                    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
                    .join(', ')})`,
                }}
                onClick={() => setPreset(preset.key)}
                title={presetLabel(labels, preset.labelKey)}
              >
                <span>{presetLabel(labels, preset.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="camera-options-row">
        <button
          type="button"
          className="cam-opt-btn cam-opt-reset"
          onClick={() => onSave({ ...cameraOptions, timecardConfig: resetTimecardConfig() })}
        >
          {labels.resetDefault}
        </button>
      </div>
    </div>
  );
}
