import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';
import { useLang } from '../../i18n';
import { communityVideoAspectRatio } from '../../lib/communityVideo';
import {
  firstAutoplaySoundAttempt,
  isLowMovementFrameTap,
  isPlaybackOutputMuted,
  shouldAbandonPlayAttempt,
  shouldAttemptMutedAutoplayFallback,
  shouldShowTransportPlay,
  type CommunityVideoSurface,
} from '../../lib/communityVideoPlayback';
import { useCommunityVideoPlayback } from './CommunityVideoPlayback';

export type CommunityVideoPlayerProps = {
  postId: string;
  surface: CommunityVideoSurface;
  src: string;
  width?: number;
  height?: number;
  className?: string;
  videoClassName?: string;
  canAttachSource?: boolean;
  wantPlay?: boolean;
  visualRef?: (el: HTMLVideoElement | null) => void;
};

function stopNav(event: SyntheticEvent) {
  event.stopPropagation();
}

export function CommunityVideoPlayer({
  postId,
  surface,
  src,
  width,
  height,
  className,
  videoClassName,
  canAttachSource: canAttachOverride,
  wantPlay: wantPlayOverride,
  visualRef,
}: CommunityVideoPlayerProps) {
  const { t } = useLang();
  const copy = t.community;
  const playback = useCommunityVideoPlayback();
  const canAttach = canAttachOverride ?? playback?.canAttachSource(postId, surface) ?? false;
  const wantPlay = wantPlayOverride ?? playback?.wantPlay(postId, surface) ?? false;
  const userPaused = playback?.isUserPaused(postId, surface) ?? false;
  const holdsToken = playback?.holdsToken(postId, surface) ?? false;
  const [localUserMuted, setLocalUserMuted] = useState(false);
  const userMuted = playback?.userMuted ?? localUserMuted;
  const autoplayRestricted = playback?.autoplayRestricted ?? false;
  const [localMutedFallback, setLocalMutedFallback] = useState(false);
  const autoplayMutedFallback = Boolean(playback?.autoplayMutedFallback) || localMutedFallback;
  const outputMuted = isPlaybackOutputMuted({ userMuted, autoplayMutedFallback });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLInputElement | null>(null);
  const playGenRef = useRef(0);
  const retryOnceRef = useRef(false);
  const progressRafRef = useRef(0);
  const userPlayRef = useRef(false);
  const grantPlayStartedRef = useRef(false);
  const tapPointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const playbackRef = useRef(playback);
  const userMutedRef = useRef(userMuted);
  const autoplayMutedFallbackRef = useRef(autoplayMutedFallback);
  playbackRef.current = playback;
  userMutedRef.current = userMuted;
  autoplayMutedFallbackRef.current = autoplayMutedFallback;
  const [playRejected, setPlayRejected] = useState(false);
  const [error, setError] = useState(false);
  const [elementPlaying, setElementPlaying] = useState(false);
  const labelId = useId();

  const setVideoNode = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      visualRef?.(el);
    },
    [visualRef],
  );

  useEffect(() => {
    if (surface !== 'feed' && surface !== 'famous') return;
    return playback?.registerFeedElement(postId, surface, rootRef.current);
  }, [playback, postId, surface]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = outputMuted;
  }, [outputMuted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (canAttach && src) {
      if (el.getAttribute('src') !== src) {
        el.src = src;
        el.preload = 'metadata';
      }
      return;
    }
    if (el.getAttribute('src') || el.src) {
      playGenRef.current += 1;
      grantPlayStartedRef.current = false;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      el.removeAttribute('src');
      el.src = '';
      el.preload = 'none';
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
  }, [canAttach, src]);

  useEffect(() => {
    if (!canAttach) setElementPlaying(false);
  }, [canAttach]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !canAttach) return;
    const shouldPlay = wantPlay && !userPaused && !error;
    if (!shouldPlay) {
      setLocalMutedFallback(false);
      if (userPlayRef.current && !userPaused && !error && canAttach) {
        return;
      }
      userPlayRef.current = false;
      playGenRef.current += 1;
      grantPlayStartedRef.current = false;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    if (grantPlayStartedRef.current) return;
    if (!el.paused && !el.ended) {
      grantPlayStartedRef.current = true;
      return;
    }
    grantPlayStartedRef.current = true;
    userPlayRef.current = false;
    playGenRef.current += 1;
    const gen = playGenRef.current;
    setPlayRejected(false);

    const abandon = () => shouldAbandonPlayAttempt(playGenRef.current, gen);

    const settle = async (): Promise<boolean> => {
      const attempt = el.play();
      if (attempt && typeof attempt.then === 'function') {
        try {
          await attempt;
          if (abandon()) {
            try {
              el.pause();
            } catch {
              /* ignore */
            }
            return false;
          }
          return true;
        } catch {
          if (abandon()) return false;
          return false;
        }
      }
      if (abandon()) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        return false;
      }
      return true;
    };

    void (async () => {
      const preferMuted =
        firstAutoplaySoundAttempt(userMutedRef.current, autoplayMutedFallbackRef.current) ===
        'muted';
      if (preferMuted) {
        el.muted = true;
        const ok = await settle();
        if (!ok && !abandon()) setPlayRejected(true);
        return;
      }
      setLocalMutedFallback(false);
      el.muted = false;
      const unmutedOk = await settle();
      if (abandon()) return;
      if (unmutedOk) return;
      if (
        !shouldAttemptMutedAutoplayFallback({
          userMuted: userMutedRef.current,
          unmutedRejected: true,
          mutedFallbackTried: false,
        })
      ) {
        setPlayRejected(true);
        return;
      }
      setLocalMutedFallback(true);
      playbackRef.current?.markAutoplayMutedFallback();
      el.muted = true;
      const mutedOk = await settle();
      if (abandon()) return;
      if (!mutedOk) setPlayRejected(true);
    })();
  }, [canAttach, error, userPaused, wantPlay]);

  useEffect(
    () => () => {
      playGenRef.current += 1;
      grantPlayStartedRef.current = false;
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      const el = videoRef.current;
      if (!el) return;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const syncProgress = useCallback(() => {
    const el = videoRef.current;
    const bar = progressRef.current;
    if (!el || !bar) return;
    const duration = Number(el.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    bar.value = String((el.currentTime / duration) * 100);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const tick = () => {
      syncProgress();
      if (!el.paused && !el.ended) {
        progressRafRef.current = requestAnimationFrame(tick);
      }
    };
    const onPlay = () => {
      setElementPlaying(true);
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setElementPlaying(false);
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      syncProgress();
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('loadedmetadata', syncProgress);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('loadedmetadata', syncProgress);
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
    };
  }, [syncProgress, canAttach, src]);

  function handleError() {
    setError(true);
    setPlayRejected(false);
  }

  function handlePlayPause() {
    const el = videoRef.current;
    if (!el) return;
    if (error) {
      if (!retryOnceRef.current) {
        retryOnceRef.current = true;
        setError(false);
        try {
          el.load();
        } catch {
          /* ignore */
        }
      }
    }
    playback?.setUserPaused(postId, surface, false);
    playback?.claimPlayback(postId, surface);
    userPlayRef.current = true;
    grantPlayStartedRef.current = true;
    setPlayRejected(false);
    el.muted = userMutedRef.current;
    playGenRef.current += 1;
    const gen = playGenRef.current;
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      void attempt.then(
        () => {
          if (shouldAbandonPlayAttempt(playGenRef.current, gen)) {
            try {
              el.pause();
            } catch {
              /* ignore */
            }
          }
        },
        () => {
          if (shouldAbandonPlayAttempt(playGenRef.current, gen)) return;
          setPlayRejected(true);
        },
      );
    }
  }

  function handlePauseClick() {
    playback?.setUserPaused(postId, surface, true);
    playGenRef.current += 1;
    grantPlayStartedRef.current = false;
    try {
      videoRef.current?.pause();
    } catch {
      /* ignore */
    }
  }

  function handleFramePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.community-video-controls')) return;
    tapPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handleFramePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = tapPointerRef.current;
    tapPointerRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.community-video-controls')) return;
    if (!isLowMovementFrameTap(start.x, start.y, event.clientX, event.clientY)) return;
    const el = videoRef.current;
    const playingNow = elementPlaying || Boolean(el && !el.paused);
    if (playingNow) {
      handlePauseClick();
      return;
    }
    if (
      shouldShowTransportPlay({
        playRejected,
        error,
        userPaused,
        autoplayRestricted,
        holdsToken,
        wantPlay,
      })
    ) {
      handlePlayPause();
    }
  }

  function handleFramePointerCancel() {
    tapPointerRef.current = null;
  }

  function handleSeek(value: string) {
    const el = videoRef.current;
    if (!el) return;
    const duration = Number(el.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const next = (Number(value) / 100) * duration;
    try {
      el.currentTime = Number.isFinite(next) ? next : 0;
    } catch {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }

  function handleMuteToggle() {
    const nextUserMuted = !outputMuted;
    playback?.setUserMuted(nextUserMuted);
    if (!playback) setLocalUserMuted(nextUserMuted);
    if (!nextUserMuted) setLocalMutedFallback(false);
    const el = videoRef.current;
    if (!el) return;
    el.muted = nextUserMuted;
    if (nextUserMuted || userPaused) return;
    if (!(wantPlay || elementPlaying)) return;
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      const gen = playGenRef.current;
      void attempt.then(
        () => {
          if (shouldAbandonPlayAttempt(playGenRef.current, gen)) {
            try {
              el.pause();
            } catch {
              /* ignore */
            }
          }
        },
        () => {
          if (shouldAbandonPlayAttempt(playGenRef.current, gen)) return;
          setPlayRejected(true);
        },
      );
    }
  }

  const aspect = communityVideoAspectRatio(width, height);
  const showPlay = shouldShowTransportPlay({
    playRejected,
    error,
    userPaused,
    autoplayRestricted,
    holdsToken,
    wantPlay,
  });
  const showPause = elementPlaying && !showPlay;
  const rootClass = [
    surface === 'gallery' ? 'community-depth-video-slot' : 'community-card-video',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const frameClass =
    surface === 'gallery' ? 'community-depth-video-frame' : 'community-card-video-frame';
  const videoClass = [
    surface === 'gallery' ? 'community-depth-video' : 'community-card-video-el',
    videoClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={rootClass}
      data-post-id={postId}
      data-surface={surface}
      data-attached={canAttach ? 'true' : 'false'}
      data-want-play={wantPlay ? 'true' : 'false'}
      style={{ '--video-aspect': aspect } as CSSProperties}
    >
      <div
        className={frameClass}
        style={{ aspectRatio: aspect }}
        onPointerDown={handleFramePointerDown}
        onPointerUp={handleFramePointerUp}
        onPointerCancel={handleFramePointerCancel}
      >
        <video
          ref={setVideoNode}
          className={videoClass}
          playsInline
          muted={outputMuted}
          preload={canAttach ? 'metadata' : 'none'}
          controls={false}
          loop
          width={width || undefined}
          height={height || undefined}
          aria-labelledby={labelId}
          onError={handleError}
        />
        <span id={labelId} className="visually-hidden">
          {copy.video}
        </span>
        {error ? (
          <p className="community-video-error" role="status">
            {copy.videoUnplayable}
          </p>
        ) : null}
        <div
          className="community-video-controls"
          data-show-transport={showPlay ? 'true' : undefined}
          onPointerDown={stopNav}
          onPointerMove={stopNav}
          onPointerUp={stopNav}
          onTouchStart={stopNav}
          onTouchMove={stopNav}
          onWheel={stopNav}
          onClick={stopNav}
        >
          {showPlay ? (
            <button
              type="button"
              className="community-video-control-btn community-video-transport"
              onClick={handlePlayPause}
              aria-label={copy.playVideo}
            >
              {copy.playVideo}
            </button>
          ) : showPause ? (
            <button
              type="button"
              className="community-video-control-btn community-video-transport"
              onClick={handlePauseClick}
              aria-label={copy.pauseVideo}
              data-playing="true"
            >
              {copy.pauseVideo}
            </button>
          ) : null}
          <input
            ref={progressRef}
            type="range"
            min={0}
            max={100}
            defaultValue={0}
            step={0.1}
            className="community-video-progress"
            aria-label={copy.video}
            onChange={(event) => handleSeek(event.target.value)}
          />
          <button
            type="button"
            className="community-video-control-btn"
            onClick={handleMuteToggle}
            aria-label={outputMuted ? copy.unmuteVideo : copy.muteVideo}
          >
            {outputMuted ? copy.unmuteVideo : copy.muteVideo}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommunityVideoPlayer;
