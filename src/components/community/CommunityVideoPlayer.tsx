import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { useLang } from '../../i18n';
import { communityVideoAspectRatio } from '../../lib/communityVideo';
import type { CommunityVideoSurface } from '../../lib/communityVideoPlayback';
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLInputElement | null>(null);
  const playGenRef = useRef(0);
  const retryOnceRef = useRef(false);
  const progressRafRef = useRef(0);
  const userPlayRef = useRef(false);
  const [ended, setEnded] = useState(false);
  const [playRejected, setPlayRejected] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(true);
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
    if (canAttach && src) {
      if (el.getAttribute('src') !== src) {
        el.src = src;
        el.preload = 'metadata';
      }
      return;
    }
    if (el.getAttribute('src') || el.src) {
      playGenRef.current += 1;
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
    const el = videoRef.current;
    if (!el || !canAttach) return;
    const shouldPlay = wantPlay && !userPaused && !ended && !error;
    if (!shouldPlay) {
      if (userPlayRef.current && !userPaused && !ended && !error && canAttach) {
        return;
      }
      userPlayRef.current = false;
      playGenRef.current += 1;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    userPlayRef.current = false;
    if (!el.paused && !el.ended) return;
    playGenRef.current += 1;
    const gen = playGenRef.current;
    setPlayRejected(false);
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      void attempt.catch(() => {
        if (playGenRef.current !== gen) return;
        setPlayRejected(true);
      });
    }
  }, [canAttach, ended, error, userPaused, wantPlay]);

  useEffect(
    () => () => {
      playGenRef.current += 1;
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
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
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

  function handleEnded() {
    setEnded(true);
    setPlayRejected(false);
    try {
      videoRef.current?.pause();
    } catch {
      /* ignore */
    }
    syncProgress();
  }

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
    if (ended) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      setEnded(false);
    }
    playback?.setUserPaused(postId, surface, false);
    playback?.claimPlayback(postId, surface);
    userPlayRef.current = true;
    setPlayRejected(false);
    playGenRef.current += 1;
    const gen = playGenRef.current;
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      void attempt.catch(() => {
        if (playGenRef.current !== gen) return;
        setPlayRejected(true);
      });
    }
  }

  function handlePauseClick() {
    playback?.setUserPaused(postId, surface, true);
    playGenRef.current += 1;
    try {
      videoRef.current?.pause();
    } catch {
      /* ignore */
    }
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
    setEnded(false);
  }

  function handleMuteToggle() {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  }

  const aspect = communityVideoAspectRatio(width, height);
  const showReplay = ended;
  const showPlay = showReplay || playRejected || error || !wantPlay || userPaused;
  const playing = wantPlay && !userPaused && !ended && !error && !playRejected;
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
      <div className={frameClass} style={{ aspectRatio: aspect }}>
        <video
          ref={setVideoNode}
          className={videoClass}
          playsInline
          muted={muted}
          preload={canAttach ? 'metadata' : 'none'}
          controls={false}
          loop={false}
          width={width || undefined}
          height={height || undefined}
          aria-labelledby={labelId}
          onEnded={handleEnded}
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
              className="community-video-control-btn"
              onClick={handlePlayPause}
              aria-label={showReplay ? copy.replayVideo : copy.playVideo}
            >
              {showReplay ? copy.replayVideo : copy.playVideo}
            </button>
          ) : (
            <button
              type="button"
              className="community-video-control-btn"
              onClick={handlePauseClick}
              aria-label={copy.pauseVideo}
              data-playing={playing ? 'true' : undefined}
            >
              {copy.pauseVideo}
            </button>
          )}
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
            aria-label={muted ? copy.unmuteVideo : copy.muteVideo}
          >
            {muted ? copy.unmuteVideo : copy.muteVideo}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommunityVideoPlayer;
