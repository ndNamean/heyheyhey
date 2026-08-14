import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePointerCapabilities } from './pointerCapabilities';
import { useIdleResetTimer } from './useIdleResetTimer';

export type VideoFloatState = 'resting' | 'base' | 'enhanced';
export type PlaybackOwner = 'none' | 'interaction' | 'user';

export const VIDEO_FLOAT = {
  IDLE_MS: 300,
  DURATION_MS: 1000,
  WILL_CHANGE_CLEAR_MS: 1000,
} as const;

type VideoListeners = {
  pause: EventListener;
  play: EventListener;
  volumechange: EventListener;
  seeking: EventListener;
  seeked: EventListener;
  ratechange: EventListener;
  enterpictureinpicture: EventListener;
  leavepictureinpicture: EventListener;
  webkitbeginfullscreen: EventListener;
  webkitendfullscreen: EventListener;
};

const listenerMap = new WeakMap<HTMLVideoElement, VideoListeners>();

function isElementOnscreen(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return true;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < (typeof window !== 'undefined' ? window.innerHeight : 0) &&
    rect.left < (typeof window !== 'undefined' ? window.innerWidth : 0)
  );
}

function isFullscreenOrPip(video: HTMLVideoElement): boolean {
  const doc = video.ownerDocument;
  const fs =
    doc.fullscreenElement ||
    (doc as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
  if (fs === video) return true;
  if (doc.pictureInPictureElement === video) return true;
  const webkit = video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };
  return Boolean(webkit.webkitDisplayingFullscreen);
}

function isIgnorablePlayError(err: unknown): boolean {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  return name === 'AbortError' || name === 'NotAllowedError';
}

function unbindVideoListeners(video: HTMLVideoElement | null) {
  if (!video) return;
  const listeners = listenerMap.get(video);
  if (!listeners) return;
  video.removeEventListener('pause', listeners.pause);
  video.removeEventListener('play', listeners.play);
  video.removeEventListener('volumechange', listeners.volumechange);
  video.removeEventListener('seeking', listeners.seeking);
  video.removeEventListener('seeked', listeners.seeked);
  video.removeEventListener('ratechange', listeners.ratechange);
  video.removeEventListener('enterpictureinpicture', listeners.enterpictureinpicture);
  video.removeEventListener('leavepictureinpicture', listeners.leavepictureinpicture);
  video.removeEventListener('webkitbeginfullscreen', listeners.webkitbeginfullscreen);
  video.removeEventListener('webkitendfullscreen', listeners.webkitendfullscreen);
  listenerMap.delete(video);
}

export function useVideoFloat(options: { enabled?: boolean; resetKey?: string } = {}) {
  const enabled = options.enabled !== false;
  const { fineHover, reducedMotion } = usePointerCapabilities();
  const [state, setState] = useState<VideoFloatState>('resting');
  const [willChange, setWillChange] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [playbackOwner, setPlaybackOwner] = useState<PlaybackOwner>('none');

  const rootRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stateRef = useRef<VideoFloatState>('resting');
  const ownerRef = useRef<PlaybackOwner>('none');
  const userPausedRef = useRef(false);
  const fineHoverRef = useRef(fineHover);
  const reducedMotionRef = useRef(reducedMotion);
  const enabledRef = useRef(enabled);
  const frozenRef = useRef(false);
  const interactionPlayRef = useRef(false);
  const interactionPauseRef = useRef(false);
  const playedThisHoverRef = useRef(false);
  const willChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  stateRef.current = state;
  ownerRef.current = playbackOwner;
  fineHoverRef.current = fineHover;
  reducedMotionRef.current = reducedMotion;
  enabledRef.current = enabled;
  frozenRef.current = frozen;

  const canFloat = useCallback(
    () => enabledRef.current && fineHoverRef.current && !reducedMotionRef.current && !frozenRef.current,
    [],
  );

  const clearWillChangeTimer = useCallback(() => {
    if (willChangeTimerRef.current != null) {
      clearTimeout(willChangeTimerRef.current);
      willChangeTimerRef.current = null;
    }
  }, []);

  const scheduleWillChangeClear = useCallback(() => {
    clearWillChangeTimer();
    willChangeTimerRef.current = setTimeout(() => {
      willChangeTimerRef.current = null;
      if (stateRef.current === 'resting') setWillChange(false);
    }, VIDEO_FLOAT.WILL_CHANGE_CLEAR_MS);
  }, [clearWillChangeTimer]);

  const resetFloat = useCallback(() => {
    setState('resting');
    stateRef.current = 'resting';
  }, []);

  const { restart: restartIdle, clear: clearIdle } = useIdleResetTimer(VIDEO_FLOAT.IDLE_MS, () => {
    if (!canFloat()) return;
    if (stateRef.current === 'base') {
      setState('enhanced');
      stateRef.current = 'enhanced';
    }
  });

  const pauseIfInteractionOwned = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (ownerRef.current !== 'interaction') {
      video.loop = false;
      return;
    }
    interactionPauseRef.current = true;
    video.loop = false;
    video.pause();
    ownerRef.current = 'none';
    setPlaybackOwner('none');
    queueMicrotask(() => {
      interactionPauseRef.current = false;
    });
  }, []);

  const interactionPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || playedThisHoverRef.current) return;
    if (ownerRef.current === 'user') return;
    if (userPausedRef.current) return;
    if (!video.paused) return;
    if (!isElementOnscreen(video)) return;

    playedThisHoverRef.current = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    interactionPlayRef.current = true;
    const result = video.play();
    const settle = (ok: boolean) => {
      interactionPlayRef.current = false;
      if (!ok) {
        video.loop = false;
        ownerRef.current = 'none';
        setPlaybackOwner('none');
        return;
      }
      if (ownerRef.current === 'user') return;
      ownerRef.current = 'interaction';
      setPlaybackOwner('interaction');
    };
    if (result && typeof result.then === 'function') {
      void result.then(() => settle(true)).catch((err: unknown) => {
        settle(false);
        if (!isIgnorablePlayError(err)) return;
      });
    } else {
      settle(true);
    }
  }, []);

  const promoteToUser = useCallback(() => {
    ownerRef.current = 'user';
    setPlaybackOwner('user');
    const video = videoRef.current;
    if (video) video.loop = false;
  }, []);

  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      const prev = videoRef.current;
      if (prev === video) return;
      unbindVideoListeners(prev);
      videoRef.current = video;
      if (!video) return;

      const listeners: VideoListeners = {
        pause: () => {
          if (interactionPauseRef.current) return;
          ownerRef.current = 'none';
          setPlaybackOwner('none');
          userPausedRef.current = true;
          video.loop = false;
        },
        play: () => {
          if (interactionPlayRef.current) return;
          userPausedRef.current = false;
        },
        volumechange: () => {
          if (!video.muted) promoteToUser();
        },
        seeking: () => promoteToUser(),
        seeked: () => promoteToUser(),
        ratechange: () => promoteToUser(),
        enterpictureinpicture: () => {
          promoteToUser();
          frozenRef.current = true;
          setFrozen(true);
          clearIdle();
          resetFloat();
        },
        leavepictureinpicture: () => {
          frozenRef.current = false;
          setFrozen(false);
        },
        webkitbeginfullscreen: () => {
          promoteToUser();
          frozenRef.current = true;
          setFrozen(true);
          clearIdle();
          resetFloat();
        },
        webkitendfullscreen: () => {
          frozenRef.current = isFullscreenOrPip(video);
          setFrozen(frozenRef.current);
        },
      };

      listenerMap.set(video, listeners);
      video.addEventListener('pause', listeners.pause);
      video.addEventListener('play', listeners.play);
      video.addEventListener('volumechange', listeners.volumechange);
      video.addEventListener('seeking', listeners.seeking);
      video.addEventListener('seeked', listeners.seeked);
      video.addEventListener('ratechange', listeners.ratechange);
      video.addEventListener('enterpictureinpicture', listeners.enterpictureinpicture);
      video.addEventListener('leavepictureinpicture', listeners.leavepictureinpicture);
      video.addEventListener('webkitbeginfullscreen', listeners.webkitbeginfullscreen);
      video.addEventListener('webkitendfullscreen', listeners.webkitendfullscreen);
    },
    [promoteToUser, clearIdle, resetFloat],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      attachVideo(root.querySelector('video'));
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { childList: true, subtree: true });
    const onFsChange = () => {
      const video = videoRef.current;
      if (!video) return;
      if (isFullscreenOrPip(video)) {
        promoteToUser();
        frozenRef.current = true;
        setFrozen(true);
        clearIdle();
        resetFloat();
      } else {
        frozenRef.current = false;
        setFrozen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      mo.disconnect();
      document.removeEventListener('fullscreenchange', onFsChange);
      attachVideo(null);
    };
  }, [options.resetKey, attachVideo, promoteToUser, clearIdle, resetFloat]);

  const resetSession = useCallback(() => {
    clearIdle();
    resetFloat();
    playedThisHoverRef.current = false;
    userPausedRef.current = false;
    ownerRef.current = 'none';
    setPlaybackOwner('none');
    frozenRef.current = false;
    setFrozen(false);
    setWillChange(false);
    clearWillChangeTimer();
  }, [clearIdle, resetFloat, clearWillChangeTimer]);

  useEffect(() => {
    resetSession();
  }, [options.resetKey, resetSession]);

  useEffect(() => {
    if (!enabled || reducedMotion || !fineHover) {
      clearIdle();
      pauseIfInteractionOwned();
      resetFloat();
      playedThisHoverRef.current = false;
      scheduleWillChangeClear();
    }
  }, [enabled, reducedMotion, fineHover, clearIdle, pauseIfInteractionOwned, resetFloat, scheduleWillChangeClear]);

  useEffect(
    () => () => {
      clearIdle();
      clearWillChangeTimer();
      pauseIfInteractionOwned();
    },
    [clearIdle, clearWillChangeTimer, pauseIfInteractionOwned],
  );

  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.target instanceof HTMLAnchorElement) return;
      if (!canFloat()) return;
      setWillChange(true);
      clearWillChangeTimer();
      setState('base');
      stateRef.current = 'base';
      restartIdle();
      interactionPlay();
    },
    [canFloat, clearWillChangeTimer, restartIdle, interactionPlay],
  );

  const onPointerMove = useCallback(() => {
    if (!canFloat()) return;
    if (stateRef.current === 'resting') return;
    if (stateRef.current === 'enhanced') {
      setState('base');
      stateRef.current = 'base';
    }
    restartIdle();
  }, [canFloat, restartIdle]);

  const onPointerLeave = useCallback(() => {
    if (!fineHoverRef.current) return;
    clearIdle();
    pauseIfInteractionOwned();
    playedThisHoverRef.current = false;
    resetFloat();
    scheduleWillChangeClear();
  }, [clearIdle, pauseIfInteractionOwned, resetFloat, scheduleWillChangeClear]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        if (stateRef.current !== 'resting') {
          event.preventDefault();
          event.stopPropagation();
          clearIdle();
          pauseIfInteractionOwned();
          playedThisHoverRef.current = false;
          resetFloat();
          scheduleWillChangeClear();
        }
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== event.currentTarget) return;
      if (!canFloat()) return;
      event.preventDefault();
      if (stateRef.current === 'resting') {
        setWillChange(true);
        setState('base');
        stateRef.current = 'base';
        restartIdle();
        interactionPlay();
      } else {
        clearIdle();
        pauseIfInteractionOwned();
        playedThisHoverRef.current = false;
        resetFloat();
        scheduleWillChangeClear();
      }
    },
    [canFloat, clearIdle, pauseIfInteractionOwned, resetFloat, scheduleWillChangeClear, restartIdle, interactionPlay],
  );

  return {
    state,
    willChange,
    frozen,
    playbackOwner,
    reducedMotion,
    fineHover,
    rootRef,
    reset: resetSession,
    bind: {
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      onKeyDown,
    },
  };
}
