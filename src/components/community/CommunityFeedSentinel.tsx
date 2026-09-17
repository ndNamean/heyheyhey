import { useEffect, useRef } from 'react';

export function canStartCommunityLoadMore(input: {
  canLoadNextPage: boolean;
  isLoadingMore: boolean;
  inFlight: boolean;
  loadNextPage: unknown;
}): boolean {
  return (
    Boolean(input.canLoadNextPage) &&
    !input.isLoadingMore &&
    !input.inFlight &&
    typeof input.loadNextPage === 'function'
  );
}

export function shouldEnableFeedSentinel(input: {
  overlayOpen: boolean;
  canLoadNextPage: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
}): boolean {
  if (input.overlayOpen || input.loadMoreError) return false;
  return input.canLoadNextPage || input.isLoadingMore;
}

interface Props {
  enabled: boolean;
  onVisible: () => void;
  /** Recreate the observer after a page append so a still-visible sentinel can load again. */
  observeKey?: string | number;
}

export default function CommunityFeedSentinel({ enabled, onVisible, observeKey = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current();
      },
      { root: null, rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, observeKey]);

  return <div ref={ref} className="community-feed-sentinel" aria-hidden="true" />;
}
