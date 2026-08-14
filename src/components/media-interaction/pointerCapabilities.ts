import { useEffect, useState } from 'react';

export const FINE_HOVER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';
export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

type MatchMediaFn = typeof window.matchMedia;

function resolveMatchMedia(
  matchMediaFn?: MatchMediaFn,
): MatchMediaFn | undefined {
  if (matchMediaFn) return matchMediaFn;
  if (typeof window === 'undefined') return undefined;
  return window.matchMedia?.bind(window);
}

function queryMatches(query: string, matchMediaFn?: MatchMediaFn): boolean {
  try {
    return Boolean(resolveMatchMedia(matchMediaFn)?.(query).matches);
  } catch {
    return false;
  }
}

/** Fine mouse/trackpad hover — not touch. Independent of ambient-glow config. */
export function hasFineHoverPointer(matchMediaFn?: MatchMediaFn): boolean {
  return queryMatches(FINE_HOVER_MEDIA_QUERY, matchMediaFn);
}

/** Respect prefers-reduced-motion for zoom/float only (not ambient-glow gated). */
export function prefersReducedMotion(matchMediaFn?: MatchMediaFn): boolean {
  return queryMatches(REDUCED_MOTION_MEDIA_QUERY, matchMediaFn);
}

function subscribeMediaQuery(mq: MediaQueryList | undefined, onChange: () => void): () => void {
  if (!mq) return () => {};
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

export function usePointerCapabilities(): { fineHover: boolean; reducedMotion: boolean } {
  const [fineHover, setFineHover] = useState(() => hasFineHoverPointer());
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const hoverMq = resolveMatchMedia()?.(FINE_HOVER_MEDIA_QUERY);
    const motionMq = resolveMatchMedia()?.(REDUCED_MOTION_MEDIA_QUERY);
    const sync = () => {
      setFineHover(Boolean(hoverMq?.matches));
      setReducedMotion(Boolean(motionMq?.matches));
    };
    sync();
    const unHover = subscribeMediaQuery(hoverMq, sync);
    const unMotion = subscribeMediaQuery(motionMq, sync);
    return () => {
      unHover();
      unMotion();
    };
  }, []);

  return { fineHover, reducedMotion };
}
