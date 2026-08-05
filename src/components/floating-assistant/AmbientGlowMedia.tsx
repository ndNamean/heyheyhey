import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ambientMediaEffects } from '../../config/ambientMediaEffects';
import {
  ambientColorCssVars,
  extractEdgeColorFromMedia,
  fallbackAmbientColor,
  prefersReducedMotion,
  resolveAmbientMotionMode,
  type Rgb,
  type SampleableMedia,
} from '../../lib/ambientMediaColor';
import './ambientGlowMedia.css';

export type AmbientGlowMediaProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Cache / CORS-failure key (e.g. GIPHY URL). */
  cacheKey?: string;
  /** Optional media element to sample; otherwise finds first img/video/canvas child. */
  mediaRef?: React.RefObject<SampleableMedia | null>;
  /** Enable gentle breathe when motion is allowed (default true). */
  breathe?: boolean;
  /**
   * One-shot bright flash. Changing this value (e.g. increment after send)
   * triggers a single pulse when motion is allowed.
   */
  flashToken?: number | string | null;
  onFlashComplete?: () => void;
  /** When false, renders children without glow chrome. */
  enabled?: boolean;
  /** Pause sampling while offscreen (default from config). */
  pauseWhenOffscreen?: boolean;
};

function findSampleable(node: HTMLElement | null): SampleableMedia | null {
  if (!node) return null;
  if (
    node instanceof HTMLImageElement ||
    node instanceof HTMLVideoElement ||
    node instanceof HTMLCanvasElement
  ) {
    return node;
  }
  return (
    node.querySelector('img, video, canvas') as SampleableMedia | null
  );
}

function ensureCrossOrigin(el: SampleableMedia): void {
  if (el instanceof HTMLImageElement && !el.crossOrigin) {
    // Must be set before a reload for CORS-tainted canvases; best-effort for already-loaded media.
    try {
      el.crossOrigin = 'anonymous';
    } catch {
      /* ignore */
    }
  }
  if (el instanceof HTMLVideoElement && !el.crossOrigin) {
    try {
      el.crossOrigin = 'anonymous';
    } catch {
      /* ignore */
    }
  }
}

/**
 * Reusable wrapper: sustained edge-matched glow + optional breathe + one-shot flash.
 * Reduced motion ⇒ sustained-only (no breathe/flash). Safe CORS fallback to #FDC216.
 * Later GIPHY / reaction media phases can wrap media with this component.
 */
export function AmbientGlowMedia({
  children,
  className,
  style,
  cacheKey,
  mediaRef,
  breathe = true,
  flashToken = null,
  onFlashComplete,
  enabled = ambientMediaEffects.enabled,
  pauseWhenOffscreen = ambientMediaEffects.colorDetection.pauseWhenOffscreen,
}: AmbientGlowMediaProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const colorRef = useRef<Rgb>(fallbackAmbientColor());
  const [color, setColor] = useState<Rgb>(() => fallbackAmbientColor());
  const [inView, setInView] = useState(true);
  const [docVisible, setDocVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const [flashing, setFlashing] = useState(false);
  const lastFlashToken = useRef<typeof flashToken>(null);
  const corsLocked = useRef(false);
  const reduced = prefersReducedMotion();
  const motionMode = resolveAmbientMotionMode(reduced);

  const sample = useCallback(() => {
    if (!enabled || corsLocked.current) return;
    if (pauseWhenOffscreen && !inView) return;
    if (
      ambientMediaEffects.colorDetection.pauseWhenDocumentHidden &&
      !docVisible
    ) {
      return;
    }

    const media =
      mediaRef?.current ?? findSampleable(rootRef.current);
    if (!media) return;
    ensureCrossOrigin(media);

    const result = extractEdgeColorFromMedia(media, {
      cacheKey,
      previousColor: colorRef.current,
      applySmoothing: true,
    });

    if (result.corsFailed) {
      corsLocked.current = true;
    }

    colorRef.current = result.color;
    setColor(result.color);
  }, [enabled, pauseWhenOffscreen, inView, docVisible, mediaRef, cacheKey]);

  useEffect(() => {
    if (!enabled || !pauseWhenOffscreen || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        setInView(entries.some((e) => e.isIntersecting));
      },
      { root: null, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, pauseWhenOffscreen]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const onVis = () => setDocVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    sample();

    const fps = ambientMediaEffects.colorDetection.sampleMovingMediaFps;
    const intervalMs = Math.max(250, Math.round(1000 / Math.max(1, fps)));
    const id = window.setInterval(() => {
      if (corsLocked.current) return;
      const media = mediaRef?.current ?? findSampleable(rootRef.current);
      if (media instanceof HTMLVideoElement && !media.paused && !media.ended) {
        sample();
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [enabled, sample, mediaRef]);

  const flashingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (flashToken == null || flashToken === '') return;
    if (lastFlashToken.current === flashToken) return;
    lastFlashToken.current = flashToken;

    if (motionMode !== 'full') return;
    if (!ambientMediaEffects.brightFlash.allowRapidRestart && flashingRef.current) {
      return;
    }

    flashingRef.current = true;
    setFlashing(true);
    const t = window.setTimeout(() => {
      flashingRef.current = false;
      setFlashing(false);
      onFlashComplete?.();
    }, ambientMediaEffects.brightFlash.durationMs);
    return () => window.clearTimeout(t);
  }, [flashToken, enabled, motionMode, onFlashComplete]);

  const cssVars = useMemo(() => ambientColorCssVars(color), [color]);
  const allowBreathe = enabled && breathe && motionMode === 'full' && inView && docVisible;
  const allowFlash = enabled && flashing && motionMode === 'full';

  const enhancedChildren = useMemo(() => {
    return Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      const type = (child as ReactElement).type;
      if (type !== 'img' && type !== 'video') return child;
      const props = (child as ReactElement<{ crossOrigin?: string }>).props;
      if (props.crossOrigin) return child;
      return cloneElement(child as ReactElement<{ crossOrigin?: string }>, {
        crossOrigin: 'anonymous',
      });
    });
  }, [children]);

  if (!enabled) {
    return <>{children}</>;
  }

  const rootClass = ['ambient-glow-media', className].filter(Boolean).join(' ');

  return (
    <span
      ref={rootRef}
      className={rootClass}
      style={{ ...cssVars, ...style } as CSSProperties}
      data-ambient-breathe={allowBreathe ? 'true' : 'false'}
      data-ambient-flash={allowFlash ? 'true' : 'false'}
      data-ambient-motion={motionMode}
    >
      <span className="ambient-glow-media__inner">{enhancedChildren}</span>
    </span>
  );
}

export default AmbientGlowMedia;
