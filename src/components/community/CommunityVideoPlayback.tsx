import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePointerCapabilities } from '../media-interaction/pointerCapabilities';
import {
  FEED_VIDEO_SETTLE_MS,
  canAttachVideoSource,
  pickDominantFeedVideo,
  resolvePlaybackToken,
  shouldWantPlay,
  soundPolicyAfterUserMuteChange,
  userPauseKey,
  type CommunityVideoPlaybackToken,
  type CommunityVideoSurface,
  type FeedVideoCandidate,
  type GalleryPlaybackState,
} from '../../lib/communityVideoPlayback';

type FeedEntry = {
  postId: string;
  surface: 'feed' | 'famous';
  el: Element;
};

type PlaybackContextValue = {
  canAttachSource: (postId: string, surface: CommunityVideoSurface) => boolean;
  wantPlay: (postId: string, surface: CommunityVideoSurface) => boolean;
  holdsToken: (postId: string, surface: CommunityVideoSurface) => boolean;
  isUserPaused: (postId: string, surface: CommunityVideoSurface) => boolean;
  setUserPaused: (postId: string, surface: CommunityVideoSurface, paused: boolean) => void;
  claimPlayback: (postId: string, surface: CommunityVideoSurface) => void;
  registerFeedElement: (
    postId: string,
    surface: 'feed' | 'famous',
    el: Element | null,
  ) => () => void;
  userMuted: boolean;
  autoplayMutedFallback: boolean;
  setUserMuted: (muted: boolean) => void;
  markAutoplayMutedFallback: () => void;
  autoplayRestricted: boolean;
};

const CommunityVideoPlaybackContext = createContext<PlaybackContextValue | null>(null);

function readSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

export function CommunityVideoPlaybackProvider({
  overlayOpen,
  selectedPostId,
  composerOpen,
  gallery,
  children,
}: {
  overlayOpen: boolean;
  selectedPostId: string | null;
  composerOpen: boolean;
  gallery: GalleryPlaybackState | null;
  children: ReactNode;
}) {
  const { reducedMotion } = usePointerCapabilities();
  const [documentHidden, setDocumentHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden,
  );
  const [saveData, setSaveData] = useState(readSaveData);
  const [feedSettled, setFeedSettled] = useState(true);
  const [feedDominant, setFeedDominant] = useState<FeedVideoCandidate | null>(null);
  const [userPausedKeys, setUserPausedKeys] = useState<Set<string>>(() => new Set());
  const [claim, setClaim] = useState<CommunityVideoPlaybackToken | null>(null);
  const [userMuted, setUserMutedState] = useState(false);
  const [autoplayMutedFallback, setAutoplayMutedFallback] = useState(false);
  const lastScrollAtRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const feedEntriesRef = useRef(new Map<string, FeedEntry>());
  const ratiosRef = useRef(new Map<string, number>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const galleryState = overlayOpen ? gallery : null;

  const syncDominant = useCallback(() => {
    const candidates: FeedVideoCandidate[] = [];
    for (const [key, entry] of feedEntriesRef.current) {
      candidates.push({
        postId: entry.postId,
        surface: entry.surface,
        ratio: ratiosRef.current.get(key) ?? 0,
      });
    }
    const next = pickDominantFeedVideo(candidates);
    setFeedDominant((prev) => {
      if (prev?.postId === next?.postId && prev?.surface === next?.surface && prev?.ratio === next?.ratio) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          for (const [key, mapped] of feedEntriesRef.current) {
            if (mapped.el !== entry.target) continue;
            ratiosRef.current.set(key, entry.intersectionRatio);
          }
        }
        syncDominant();
      },
      { root: null, threshold: [0, 0.25, 0.6, 0.75, 1] },
    );
    observerRef.current = observer;
    for (const entry of feedEntriesRef.current.values()) observer.observe(entry.el);
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [syncDominant]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      lastScrollAtRef.current = performance.now();
      setFeedSettled(false);
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        setFeedSettled(true);
      }, FEED_VIDEO_SETTLE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void };
    }).connection;
    if (!connection?.addEventListener) return;
    const sync = () => setSaveData(readSaveData());
    connection.addEventListener('change', sync);
    return () => connection.removeEventListener?.('change', sync);
  }, []);

  const token = useMemo(
    () =>
      resolvePlaybackToken({
        gallery: galleryState,
        selectedPostId,
        feedSettled,
        feedDominant,
        claim,
      }),
    [claim, feedDominant, feedSettled, galleryState, selectedPostId],
  );

  useEffect(() => {
    if (!claim) return;
    if (galleryState) {
      if (claim.surface !== 'gallery' || claim.postId !== galleryState.currentPostId) {
        setClaim(null);
      }
      return;
    }
    if (claim.surface === 'detail') {
      if (selectedPostId !== claim.postId) setClaim(null);
      return;
    }
    if (
      feedDominant &&
      (feedDominant.postId !== claim.postId || feedDominant.surface !== claim.surface)
    ) {
      setClaim(null);
    }
  }, [claim, feedDominant, galleryState, selectedPostId]);

  useEffect(() => {
    if (!token) return;
    const keep = userPauseKey(token.postId, token.surface);
    setUserPausedKeys((prev) => {
      if (prev.size === 0 || (prev.size === 1 && prev.has(keep))) return prev;
      if (!prev.has(keep)) return new Set();
      return new Set([keep]);
    });
  }, [token]);

  const tokenKey = token ? userPauseKey(token.postId, token.surface) : '';
  useEffect(() => {
    setAutoplayMutedFallback(false);
  }, [tokenKey]);

  const registerFeedElement = useCallback(
    (postId: string, surface: 'feed' | 'famous', el: Element | null) => {
      const key = userPauseKey(postId, surface);
      if (!el) return () => {};
      feedEntriesRef.current.set(key, { postId, surface, el });
      observerRef.current?.observe(el);
      return () => {
        const mapped = feedEntriesRef.current.get(key);
        if (mapped?.el) observerRef.current?.unobserve(mapped.el);
        feedEntriesRef.current.delete(key);
        ratiosRef.current.delete(key);
        syncDominant();
      };
    },
    [syncDominant],
  );

  const setUserPaused = useCallback(
    (postId: string, surface: CommunityVideoSurface, paused: boolean) => {
      const key = userPauseKey(postId, surface);
      setUserPausedKeys((prev) => {
        const has = prev.has(key);
        if (paused && has) return prev;
        if (!paused && !has) return prev;
        const next = new Set(prev);
        if (paused) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [],
  );

  const claimPlayback = useCallback((postId: string, surface: CommunityVideoSurface) => {
    setClaim({ postId, surface });
    if (surface === 'feed' || surface === 'famous') {
      setFeedDominant({ postId, surface, ratio: 1 });
    }
    const key = userPauseKey(postId, surface);
    setUserPausedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const setUserMuted = useCallback((muted: boolean) => {
    const next = soundPolicyAfterUserMuteChange(muted);
    setUserMutedState(next.userMuted);
    setAutoplayMutedFallback(next.autoplayMutedFallback);
  }, []);

  const markAutoplayMutedFallback = useCallback(() => {
    setAutoplayMutedFallback(true);
  }, []);

  const value = useMemo<PlaybackContextValue>(() => {
    const galleryForAttach = galleryState
      ? { currentPostId: galleryState.currentPostId, nextPostId: galleryState.nextPostId }
      : null;
    return {
      canAttachSource: (postId, surface) =>
        canAttachVideoSource({
          postId,
          surface,
          gallery: galleryForAttach,
          selectedPostId,
          feedDominant,
          claim,
        }),
      wantPlay: (postId, surface) =>
        shouldWantPlay({
          token,
          postId,
          surface,
          userPaused: userPausedKeys.has(userPauseKey(postId, surface)),
          reducedMotion,
          saveData,
          documentHidden,
          composerOpen,
          claimed: claim?.postId === postId && claim?.surface === surface,
        }),
      isUserPaused: (postId, surface) => userPausedKeys.has(userPauseKey(postId, surface)),
      holdsToken: (postId, surface) =>
        Boolean(token && token.postId === postId && token.surface === surface),
      setUserPaused,
      claimPlayback,
      registerFeedElement,
      userMuted,
      autoplayMutedFallback,
      setUserMuted,
      markAutoplayMutedFallback,
      autoplayRestricted: reducedMotion || saveData,
    };
  }, [
    autoplayMutedFallback,
    claim,
    claimPlayback,
    composerOpen,
    documentHidden,
    feedDominant,
    galleryState,
    markAutoplayMutedFallback,
    reducedMotion,
    registerFeedElement,
    saveData,
    selectedPostId,
    setUserMuted,
    setUserPaused,
    token,
    userMuted,
    userPausedKeys,
  ]);

  return (
    <CommunityVideoPlaybackContext.Provider value={value}>
      {children}
    </CommunityVideoPlaybackContext.Provider>
  );
}

export function useCommunityVideoPlayback(): PlaybackContextValue | null {
  return useContext(CommunityVideoPlaybackContext);
}
