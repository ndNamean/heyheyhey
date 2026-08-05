import { AmbientGlowMedia } from './AmbientGlowMedia';
import type { GiphyMediaItem } from '../../lib/giphyClient';
import {
  GIPHY_ATTRIBUTION_URL,
  GIPHY_POWERED_BY_MARK,
} from '../../lib/giphyClient';
import { storeChatMediaLabel } from '../../lib/storeChatMediaPayload';
import './giphyPicker.css';

export type GiphyMediaPreviewProps = {
  item: GiphyMediaItem;
  onClear?: () => void;
  /** Hint under the title (default: send-ready, not auto-sent). */
  hint?: string;
  className?: string;
  /** Low-risk AmbientGlowMedia wrap around the preview image. */
  ambientGlow?: boolean;
  removeLabel?: string;
  previewAriaLabel?: string;
};

/**
 * Composer selection preview — select → preview → send.
 * Does not send; parent clears via `onClear` or after successful send.
 */
export function GiphyMediaPreview({
  item,
  onClear,
  hint = 'Ready to send — tap Send when ready',
  className,
  ambientGlow = true,
  removeLabel = 'Remove GIF',
  previewAriaLabel,
}: GiphyMediaPreviewProps) {
  const label = storeChatMediaLabel('giphy_media', item.kind);
  const rootClass = ['giphy-media-preview', className].filter(Boolean).join(' ');
  const groupLabel = previewAriaLabel || `${label} preview`;

  const img = (
    <img
      src={item.previewUrl || item.url}
      alt={item.title || label}
      width={item.width || undefined}
      height={item.height || undefined}
      loading="lazy"
      decoding="async"
    />
  );

  return (
    <div className={rootClass} data-giphy-kind={item.kind} role="group" aria-label={groupLabel}>
      <div className="giphy-media-preview__frame">
        {ambientGlow ? (
          <AmbientGlowMedia cacheKey={item.url || item.id} breathe>
            {img}
          </AmbientGlowMedia>
        ) : (
          img
        )}
      </div>
      <div className="giphy-media-preview__meta">
        <p className="giphy-media-preview__title">{item.title || label}</p>
        <p className="giphy-media-preview__hint">{hint}</p>
        <a
          className="giphy-media-preview__attribution"
          href={item.itemUrl || GIPHY_ATTRIBUTION_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {GIPHY_POWERED_BY_MARK}
        </a>
      </div>
      {onClear ? (
        <button
          type="button"
          className="giphy-media-preview__clear"
          aria-label={removeLabel}
          onClick={onClear}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export default GiphyMediaPreview;
