import { useLang } from '../../i18n';
import { resolveGradientCss } from '../../lib/watermarkGradients';
import type { AvatarBackgroundChoice } from '../../lib/avatarCompose';
import type { UltimateGradientPreset } from '../../types';

interface Props {
  value: AvatarBackgroundChoice;
  resolvedPreset?: UltimateGradientPreset;
  onChange: (next: AvatarBackgroundChoice) => void;
  previewUrl: string | null;
}

export default function AvatarBackgroundSelector({
  value,
  resolvedPreset,
  onChange,
  previewUrl,
}: Props) {
  const { t } = useLang();

  const cards: { id: string; label: string; choice: AvatarBackgroundChoice; css?: string }[] = [
    {
      id: 'best',
      label: t.profile.avatarBestContrast,
      choice: { kind: 'best_contrast' },
      css: resolvedPreset
        ? resolveGradientCss(resolvedPreset)
        : 'linear-gradient(135deg, #0b0b0b, #00f2fe)',
    },
    {
      id: 'luxury_ceo',
      label: t.profile.avatarGradientLuxuryCeo,
      choice: { kind: 'gradient', preset: 'luxury_ceo' },
      css: resolveGradientCss('luxury_ceo'),
    },
    {
      id: 'cyberpunk',
      label: t.profile.avatarGradientCyberpunk,
      choice: { kind: 'gradient', preset: 'cyberpunk' },
      css: resolveGradientCss('cyberpunk'),
    },
    {
      id: 'royal_mystique',
      label: t.profile.avatarGradientRoyalMystique,
      choice: { kind: 'gradient', preset: 'royal_mystique' },
      css: resolveGradientCss('royal_mystique'),
    },
    {
      id: 'volcanic_energy',
      label: t.profile.avatarGradientVolcanic,
      choice: { kind: 'gradient', preset: 'volcanic_energy' },
      css: resolveGradientCss('volcanic_energy'),
    },
    {
      id: 'moody_monochrome',
      label: t.profile.avatarGradientMoody,
      choice: { kind: 'gradient', preset: 'moody_monochrome' },
      css: resolveGradientCss('moody_monochrome'),
    },
    {
      id: 'solid',
      label: t.profile.avatarSolidDark,
      choice: { kind: 'solid' },
      css: 'rgba(10, 10, 12, 1)',
    },
    {
      id: 'transparent',
      label: t.profile.avatarTransparent,
      choice: { kind: 'transparent' },
      css: 'repeating-conic-gradient(#333 0% 25%, #555 0% 50%) 50% / 16px 16px',
    },
  ];

  function isSelected(choice: AvatarBackgroundChoice): boolean {
    if (value.kind !== choice.kind) return false;
    if (value.kind === 'gradient' && choice.kind === 'gradient') {
      return value.preset === choice.preset;
    }
    return true;
  }

  return (
    <div className="profile-avatar-bg-section">
      <h3 style={{ margin: '0 0 8px' }}>{t.profile.avatarBackground}</h3>
      <p className="small" style={{ marginTop: 0 }}>{t.profile.avatarBackgroundHint}</p>
      <div className="profile-avatar-bg-grid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`profile-avatar-bg-card${isSelected(card.choice) ? ' active' : ''}`}
            onClick={() => onChange(card.choice)}
          >
            <div
              className="profile-avatar-bg-swatch"
              style={{ background: card.css }}
            >
              {previewUrl && (
                <img src={previewUrl} alt="" className="profile-avatar-bg-swatch-img" />
              )}
            </div>
            <span className="small">{card.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
