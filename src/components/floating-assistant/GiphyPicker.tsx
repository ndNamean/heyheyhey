import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../../i18n';
import {
  GIPHY_ATTRIBUTION_URL,
  GIPHY_MEME_PRESETS,
  GIPHY_POWERED_BY_MARK,
  GIPHY_SEARCH_DEBOUNCE_MS,
  createDebouncedGiphySearch,
  isGiphyConfigured,
  type GiphyMediaItem,
  type GiphyPickerTab,
  GiphyClientError,
} from '../../lib/giphyClient';
import './giphyPicker.css';

export type GiphyPickerSurface = 'desktop' | 'mobile';

export type GiphyPickerProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Called when the user confirms a selection (Use button or Enter on focused cell
   * after selection). Never fires on grid tap alone — select → preview → confirm.
   */
  onSelect: (item: GiphyMediaItem) => void;
  surface?: GiphyPickerSurface;
  /** Anchor for desktop popover placement (e.g. media button). */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
};

function useIsMobileSurface(forced?: GiphyPickerSurface): GiphyPickerSurface {
  const [auto, setAuto] = useState<GiphyPickerSurface>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'desktop';
    }
    return window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'desktop';
  });
  useEffect(() => {
    if (forced) return;
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setAuto(mq.matches ? 'mobile' : 'desktop');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [forced]);
  return forced ?? auto;
}

function placePopover(
  anchor: HTMLElement | null,
): CSSProperties {
  const pad = 12;
  const width = Math.min(420, window.innerWidth - pad * 2);
  const height = Math.min(520, window.innerHeight - 96);
  if (!anchor) {
    return {
      bottom: 96,
      left: Math.max(pad, (window.innerWidth - width) / 2),
      width,
      maxHeight: height,
    };
  }
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - pad) {
    left = window.innerWidth - pad - width;
  }
  left = Math.max(pad, left);
  const spaceAbove = rect.top - pad;
  const preferAbove = spaceAbove >= Math.min(360, height);
  if (preferAbove) {
    return {
      top: Math.max(pad, rect.top - height - 8),
      left,
      width,
      maxHeight: Math.min(height, spaceAbove),
    };
  }
  return {
    top: Math.min(rect.bottom + 8, window.innerHeight - pad - 200),
    left,
    width,
    maxHeight: Math.min(height, window.innerHeight - rect.bottom - pad * 2),
  };
}

/**
 * GIPHY media picker: GIFs / Stickers / Memes / Animated Emoji.
 * Selection is staged (highlight + Use) — does not auto-send on tap.
 */
export function GiphyPicker({
  open,
  onClose,
  onSelect,
  surface: surfaceProp,
  anchorRef,
  className,
}: GiphyPickerProps) {
  const { t } = useLang();
  const sc = t.storeChat;
  const tabs = useMemo(
    () =>
      [
        { id: 'gifs' as const, label: sc.tabGifs },
        { id: 'stickers' as const, label: sc.tabStickers },
        { id: 'memes' as const, label: sc.tabMemes },
        { id: 'emoji' as const, label: sc.tabEmoji },
      ] satisfies { id: GiphyPickerTab; label: string }[],
    [sc.tabEmoji, sc.tabGifs, sc.tabMemes, sc.tabStickers],
  );
  const titleId = useId();
  const surface = useIsMobileSurface(surfaceProp);
  const configured = isGiphyConfigured();
  const [tab, setTab] = useState<GiphyPickerTab>('gifs');
  const [query, setQuery] = useState('');
  const [memePreset, setMemePreset] = useState<string>(GIPHY_MEME_PRESETS[0]);
  const [items, setItems] = useState<GiphyMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<GiphyMediaItem | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const searchRef = useRef(createDebouncedGiphySearch(GIPHY_SEARCH_DEBOUNCE_MS));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const controller = searchRef.current;
    return () => controller.cancel();
  }, []);

  useEffect(() => {
    if (!open) {
      searchRef.current.cancel();
      setStaged(null);
      setError(null);
      return;
    }
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || surface !== 'desktop') return;
    const sync = () => setPopoverStyle(placePopover(anchorRef?.current ?? null));
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [open, surface, anchorRef]);

  useEffect(() => {
    if (!open || !configured) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setItems([]);
    void searchRef.current
      .schedule({
        tab,
        query,
        memePreset: tab === 'memes' ? memePreset : undefined,
      })
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof GiphyClientError && err.code === 'aborted') return;
        setLoading(false);
        setError(err instanceof Error ? err.message : sc.giphyLoadError);
      });
    return () => {
      alive = false;
    };
  }, [open, configured, tab, query, memePreset, sc.giphyLoadError]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirmSelection = () => {
    if (!staged) return;
    onSelect(staged);
    setStaged(null);
    onClose();
  };

  const onCellKeyDown = (e: KeyboardEvent<HTMLButtonElement>, item: GiphyMediaItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setStaged(item);
    }
  };

  const rootClass = ['giphy-picker-root', className].filter(Boolean).join(' ');
  const panelClass = [
    'giphy-picker',
    surface === 'mobile' ? 'giphy-picker--sheet' : 'giphy-picker--popover',
  ].join(' ');

  const body = (
    <div className={rootClass}>
      <button
        type="button"
        className="giphy-picker-backdrop"
        aria-label={sc.closeGiphyPicker}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={panelClass}
        style={surface === 'desktop' ? popoverStyle : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="giphy-picker__header">
          <h2 id={titleId} className="giphy-picker__title">
            {sc.giphyTitle}
          </h2>
          <button
            type="button"
            className="giphy-picker__close"
            aria-label={t.common.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="giphy-picker__tabs" role="tablist" aria-label={sc.giphyCategories}>
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              className="giphy-picker__tab"
              aria-selected={tab === tabItem.id}
              id={`giphy-tab-${tabItem.id}`}
              onClick={() => {
                setTab(tabItem.id);
                setStaged(null);
              }}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        <div className="giphy-picker__search">
          <input
            ref={searchInputRef}
            className="giphy-picker__search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'emoji'
                ? sc.searchEmoji
                : tab === 'memes'
                  ? sc.searchMemes
                  : tab === 'stickers'
                    ? sc.searchStickers
                    : sc.searchGifs
            }
            aria-label={sc.searchGiphy}
            disabled={!configured}
          />
        </div>

        {tab === 'memes' && !query.trim() ? (
          <div className="giphy-picker__presets" role="group" aria-label={sc.memePresets}>
            {GIPHY_MEME_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="giphy-picker__preset"
                aria-pressed={memePreset === preset}
                onClick={() => {
                  setMemePreset(preset);
                  setStaged(null);
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="giphy-picker__body"
          role="tabpanel"
          aria-labelledby={`giphy-tab-${tab}`}
        >
          {!configured ? (
            <p className="giphy-picker__status giphy-picker__status--error">
              {sc.giphyNotConfigured}
            </p>
          ) : loading && items.length === 0 ? (
            <p className="giphy-picker__status" aria-live="polite">
              {t.common.loading}
            </p>
          ) : error ? (
            <p className="giphy-picker__status giphy-picker__status--error" role="alert">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="giphy-picker__status">{sc.noResults}</p>
          ) : (
            <ul className="giphy-picker__grid">
              {items.map((item) => {
                const pressed = staged?.id === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="giphy-picker__cell"
                      aria-label={item.title || sc.giphyMedia}
                      aria-pressed={pressed}
                      onClick={() => setStaged(item)}
                      onKeyDown={(e) => onCellKeyDown(e, item)}
                    >
                      <img
                        src={item.previewUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={item.width || undefined}
                        height={item.height || undefined}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="giphy-picker__footer">
          <a
            className="giphy-picker__attribution"
            href={GIPHY_ATTRIBUTION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="giphy-picker__attribution-mark">{GIPHY_POWERED_BY_MARK}</span>
          </a>
          <button
            type="button"
            className="giphy-picker__use"
            disabled={!staged}
            onClick={confirmSelection}
          >
            {sc.useGif}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return body;
  return createPortal(body, document.body);
}

export default GiphyPicker;
