import type { CameraOptions, UltimateBoxItems, UltimateGradientPreset, UltimateWatermarkConfig } from '../types';
import { GRADIENT_PRESETS } from '../lib/watermarkGradients';
import { resetUltimateConfig } from '../lib/ultimateWatermarkConfig';

interface Labels {
  boxItems: string;
  gradient: string;
  gradientOn: string;
  gradientOff: string;
  layoutMode: string;
  layoutStrip: string;
  layoutLogoDock: string;
  resetDefault: string;
  itemLogo: string;
  itemUser: string;
  itemStore: string;
  itemTask: string;
  itemTimestamp: string;
  itemAddress: string;
  itemWeather: string;
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

const BOX_ITEM_KEYS: Array<{ key: keyof UltimateBoxItems; labelKey: keyof Labels }> = [
  { key: 'logo', labelKey: 'itemLogo' },
  { key: 'userName', labelKey: 'itemUser' },
  { key: 'storeCode', labelKey: 'itemStore' },
  { key: 'taskItem', labelKey: 'itemTask' },
  { key: 'timestamp', labelKey: 'itemTimestamp' },
  { key: 'address', labelKey: 'itemAddress' },
  { key: 'weather', labelKey: 'itemWeather' },
];

function presetLabel(labels: Labels, labelKey: string): string {
  return labels[labelKey as keyof Labels] ?? labelKey;
}

function patchConfig(
  cameraOptions: CameraOptions,
  patch: Partial<UltimateWatermarkConfig>,
): CameraOptions {
  const current = cameraOptions.watermarkConfig ?? resetUltimateConfig();
  return {
    ...cameraOptions,
    watermarkConfig: { ...current, ...patch },
  };
}

export default function UltimateWatermarkSettings({ cameraOptions, labels, onSave }: Props) {
  const config = cameraOptions.watermarkConfig ?? resetUltimateConfig();

  function toggleBoxItem(key: keyof UltimateBoxItems) {
    onSave(
      patchConfig(cameraOptions, {
        boxItems: { ...config.boxItems, [key]: !config.boxItems[key] },
      }),
    );
  }

  function setPreset(preset: UltimateGradientPreset) {
    onSave(patchConfig(cameraOptions, { boxGradientPreset: preset }));
  }

  return (
    <div className="camera-options-ultimate">
      <div className="camera-options-ultimate-section">
        <span className="camera-options-ultimate-label">{labels.boxItems}</span>
        <div className="camera-options-item-grid">
          {BOX_ITEM_KEYS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              className={`cam-opt-toggle cam-opt-toggle-sm${config.boxItems[key] ? ' active' : ''}`}
              onClick={() => toggleBoxItem(key)}
            >
              {labels[labelKey]}
            </button>
          ))}
        </div>
      </div>

      <div className="camera-options-row">
        <span>{labels.gradient}</span>
        <button
          type="button"
          className="cam-opt-toggle"
          onClick={() =>
            onSave(
              patchConfig(cameraOptions, { boxGradientEnabled: !config.boxGradientEnabled }),
            )
          }
        >
          {config.boxGradientEnabled ? labels.gradientOn : labels.gradientOff}
        </button>
      </div>

      {config.boxGradientEnabled && (
        <div className="camera-options-ultimate-section">
          <div className="camera-options-preset-row">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`cam-opt-preset${config.boxGradientPreset === preset.key ? ' active' : ''}`}
                style={{ background: `linear-gradient(135deg, ${preset.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})` }}
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
        <span>{labels.layoutMode}</span>
        <button
          type="button"
          className="cam-opt-toggle"
          onClick={() =>
            onSave(
              patchConfig(cameraOptions, {
                layoutMode: config.layoutMode === 'logo_dock' ? 'strip' : 'logo_dock',
              }),
            )
          }
        >
          {config.layoutMode === 'logo_dock' ? labels.layoutLogoDock : labels.layoutStrip}
        </button>
      </div>

      <div className="camera-options-row">
        <button
          type="button"
          className="cam-opt-btn cam-opt-reset"
          onClick={() => onSave({ ...cameraOptions, watermarkConfig: resetUltimateConfig() })}
        >
          {labels.resetDefault}
        </button>
      </div>
    </div>
  );
}
