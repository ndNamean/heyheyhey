import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../../../i18n';
import { resolveChatAttachmentUrl } from '../../../lib/chatAttachmentDisplay';
import { isCommunityVideoPost } from '../../../lib/communityVideo';
import { galleryPlayPostId, type GalleryPlaybackState } from '../../../lib/communityVideoPlayback';
import { BACK_PRIORITY, useNativeBack } from '../../../lib/nativeBack';
import { usePointerCapabilities } from '../../media-interaction/pointerCapabilities';
import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import { MessageBody } from '../../floating-assistant/MessageBody';
import CommunityVideoPlayer from '../CommunityVideoPlayer';
import {
  ambientBlurPx,
  ambientSpreadScale,
  freezeAllAmbientSamplers,
  resumeAllAmbientSamplers,
  setAmbientReducedMotion,
} from './ambientSampler';
import { AtmosphereCanvas } from './atmosphereCanvas';
import CommunityDepthAmbient from './CommunityDepthAmbient';
import CommunityDepthOrnaments from './CommunityDepthOrnaments';
import CommunityDepthRipples from './CommunityDepthRipples';
import {
  composeIdleFrameScale,
  composeIdleImageScale,
  containRectForStack,
  coverScaleForStack,
  frameExpandScaleForOverlay,
  isGalleryScrollStill,
  resolveIdleImageSize,
  stepGalleryIdle,
  stepGalleryPlaybackDwell,
} from './galleryIdle';
import { ornamentOpacity, ornamentRevealForIndex } from './galleryOrnaments';
import {
  ornamentRippleShouldFire,
  ornamentRippleShouldFireStart,
  ornamentRippleShouldReset,
} from './ornamentRipple';
import { resolveGalleryMood, parseMoodHex, lerpMood } from './moodController';
import { HEY_PELO_FALLBACK_MOOD } from './communityGalleryMoods';
import {
  GalleryLayers,
  MOOD_SAMPLE_OFFSET,
  PLANE_GAP,
  getDepthProgress,
  getPlaneZ,
  type DepthBlendData,
} from './galleryLayers';
import {
  SCROLL_TO_WORLD_FACTOR,
  ScrollController,
  VELOCITY_MAX,
} from './scrollController';
import {
  appendGallerySession,
  buildCommunityGalleryPosts,
  galleryRenderWindow,
  galleryWindowPostIds,
  isCommunityImagePost,
  shouldPrefetchGallery,
  shouldShowGalleryEnd,
} from './gallerySet';
import {
  PORTRAIT_STACK_SCALE,
  computeGalleryOffsets,
  getStableOrientation,
  layerMotionForGalleryIndex,
  layerTransformCss,
  type Orientation,
} from './rotationMotion';

export {
  COMMUNITY_GALLERY_RENDER_RADIUS,
  buildCommunityGalleryPosts,
  isCommunityImagePost,
} from './gallerySet';

/** Stable 4:5 stand-in so text/file planes share contain/idle math without a bitmap. */
const TEXT_CARD_FALLBACK = { width: 4, height: 5 };

export function dominantGalleryPostId(
  posts: Array<{ id: string }>,
  blend: Pick<DepthBlendData, 'currentPlaneIndex' | 'nextPlaneIndex' | 'depthBlend'>,
  fallbackId: string,
): string {
  const index = blend.depthBlend < 0.5 ? blend.currentPlaneIndex : blend.nextPlaneIndex;
  return posts[index]?.id || fallbackId;
}

function cameraZForPlaneIndex(index: number, planeGap = PLANE_GAP): number {
  return getPlaneZ(index, planeGap) + planeGap * MOOD_SAMPLE_OFFSET;
}

function relativeLuminance(hex: string): number {
  const rgb = parseMoodHex(hex);
  if (!rgb) return 1;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function moodForPost(post: CommunityPost | undefined) {
  if (!post) return HEY_PELO_FALLBACK_MOOD;
  return resolveGalleryMood({
    postId: post.id,
    moodBackgroundColor: post.moodBackgroundColor,
    moodBlob1Color: post.moodBlob1Color,
    moodBlob2Color: post.moodBlob2Color,
  });
}

function growLayerCount(layers: GalleryLayers, planeCount: number) {
  const prev = layers.opacities.slice();
  layers.setPlaneCount(planeCount);
  layers.opacities = Array.from({ length: planeCount }, (_, i) => prev[i] ?? 0);
}

const EMPTY_REACTIONS = new Map<string, CommunityReaction[]>();
const EMPTY_COMMENTS = new Map<string, CommunityComment[]>();
const EMPTY_PROFILES = new Map<string, AvatarProfileFields>();

interface Props {
  sourcePosts: CommunityPost[];
  startPostId: string;
  onClose: (postId: string) => void;
  reactionsByPostId?: ReadonlyMap<string, CommunityReaction[]>;
  commentsByPostId?: ReadonlyMap<string, CommunityComment[]>;
  reactorProfiles?: ReadonlyMap<string, AvatarProfileFields>;
  onNeedMore?: () => void;
  canLoadNextPage?: boolean;
  isLoadingMore?: boolean;
  loadMoreError?: boolean;
  onMountedPostIdsChange?: (postIds: string[]) => void;
  onGalleryPlaybackChange?: (state: GalleryPlaybackState) => void;
}

export default function CommunityDepthGallery({
  sourcePosts,
  startPostId,
  onClose,
  reactionsByPostId = EMPTY_REACTIONS,
  commentsByPostId = EMPTY_COMMENTS,
  reactorProfiles = EMPTY_PROFILES,
  onNeedMore,
  canLoadNextPage = true,
  isLoadingMore = false,
  loadMoreError = false,
  onMountedPostIdsChange,
  onGalleryPlaybackChange,
}: Props) {
  const { t } = useLang();
  const copy = t.community;
  const { reducedMotion } = usePointerCapabilities();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const visualRefs = useRef(new Map<string, HTMLElement>());
  const ambientRefs = useRef(new Map<string, HTMLDivElement>());
  const ornamentRefs = useRef(new Map<string, HTMLDivElement>());
  const rippleRefs = useRef(new Map<string, HTMLDivElement>());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const currentPostIdRef = useRef(startPostId);
  const scrollRef = useRef<ScrollController | null>(null);
  const layersRef = useRef<GalleryLayers | null>(null);
  const lastPlaneCountRef = useRef(0);
  const onNeedMoreRef = useRef(onNeedMore);
  onNeedMoreRef.current = onNeedMore;

  const startIndexRef = useRef(
    buildCommunityGalleryPosts(sourcePosts, startPostId).startIndex,
  );
  const [posts, setPosts] = useState(() => buildCommunityGalleryPosts(sourcePosts, startPostId).posts);
  const startIndex = startIndexRef.current;
  const onGalleryPlaybackChangeRef = useRef(onGalleryPlaybackChange);
  onGalleryPlaybackChangeRef.current = onGalleryPlaybackChange;
  const [planePair, setPlanePair] = useState(() => ({
    current: startIndex,
    next: Math.min(startIndex + 1, Math.max(0, buildCommunityGalleryPosts(sourcePosts, startPostId).posts.length - 1)),
  }));

  const postsRef = useRef(posts);
  postsRef.current = posts;

  useLayoutEffect(() => {
    setPosts((prev) => appendGallerySession(prev, sourcePosts));
  }, [sourcePosts]);

  useLayoutEffect(() => {
    const n = posts.length;
    const scroll = scrollRef.current;
    const layers = layersRef.current;
    if (!scroll || !layers || n <= lastPlaneCountRef.current) return;
    scroll.setPlaneCount(n);
    growLayerCount(layers, n);
    lastPlaneCountRef.current = n;
  }, [posts.length]);

  const mountedIds = useMemo(
    () => galleryWindowPostIds(posts, planePair.current, planePair.next),
    [posts, planePair.current, planePair.next],
  );

  useEffect(() => {
    onMountedPostIdsChange?.(mountedIds);
  }, [mountedIds, onMountedPostIdsChange]);

  useEffect(() => {
    if (!onNeedMoreRef.current) return;
    if (!canLoadNextPage || isLoadingMore || loadMoreError) return;
    if (!shouldPrefetchGallery(planePair.current, posts.length)) return;
    onNeedMoreRef.current();
  }, [planePair.current, posts.length, canLoadNextPage, isLoadingMore, loadMoreError]);

  function exitToPost() {
    onCloseRef.current(currentPostIdRef.current || startPostId);
  }

  useNativeBack(
    () => {
      exitToPost();
      return true;
    },
    true,
    BACK_PRIORITY.MODAL,
  );

  useEffect(() => {
    const effectPosts = postsRef.current;
    const effectStartIndex = startIndexRef.current;
    if (!effectPosts.length) {
      onCloseRef.current(startPostId);
      return;
    }

    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root) return;

    const overlayRoot = root;
    const overlayCanvas = canvas;
    const scroll = new ScrollController({ planeCount: effectPosts.length });
    const layers = new GalleryLayers(effectPosts.length);
    const atmosphere = new AtmosphereCanvas();
    const usedCanvas = overlayCanvas ? atmosphere.attach(overlayCanvas) : false;
    scrollRef.current = scroll;
    layersRef.current = layers;
    lastPlaneCountRef.current = effectPosts.length;

    const targetZ = cameraZForPlaneIndex(effectStartIndex);
    const startScroll = scroll.scrollFromCameraZ(targetZ);
    scroll.scrollTarget = startScroll;
    scroll.scrollCurrent = startScroll;
    scroll.previousScrollCurrent = startScroll;
    scroll.update();

    scroll.attach(root);
    currentPostIdRef.current = effectPosts[effectStartIndex]?.id || startPostId;

    let raf = 0;
    let running = true;
    let chromeDark = relativeLuminance(moodForPost(effectPosts[effectStartIndex]).backgroundColor) < 0.5;
    let idle = { lastNow: 0, stillMs: 0, idleAmount: 0, vanishAmount: 0 };
    let playbackDwell = { lastNow: 0, stillMs: 0, settled: false };
    const firedStartRipples = new Set<string>();
    const firedEndRipples = new Set<string>();
    const started = performance.now();
    let lastNotifiedCurrent = Number.NaN;
    let lastNotifiedNext = Number.NaN;
    let lastNotifiedSettled: boolean | null = null;
    let lastNotifiedPlay = '';

    function sizeCanvas() {
      if (!overlayCanvas) return;
      const cssW = Math.max(1, overlayRoot.clientWidth);
      const cssH = Math.max(1, overlayRoot.clientHeight);
      const w = Math.max(64, Math.min(240, Math.round(cssW * 0.4)));
      const h = Math.max(64, Math.round(w * (cssH / cssW)));
      if (overlayCanvas.width !== w) overlayCanvas.width = w;
      if (overlayCanvas.height !== h) overlayCanvas.height = h;
    }

    function applyChrome(hex: string) {
      const L = relativeLuminance(hex);
      if (chromeDark && L > 0.55) chromeDark = false;
      else if (!chromeDark && L < 0.45) chromeDark = true;
      const btn = closeRef.current;
      if (btn) btn.dataset.theme = chromeDark ? 'on-dark' : 'on-light';
    }

    function frame(now: number) {
      if (!running || document.hidden) return;

      sizeCanvas();
      const framePosts = postsRef.current;
      const planeCount = framePosts.length;
      const state = scroll.update(layers.getDepthRange());
      const blend = layers.getPlaneBlendData(state.cameraZ);
      currentPostIdRef.current = dominantGalleryPostId(framePosts, blend, startPostId);
      const opacities = layers.updateOpacities(state.cameraZ);
      const currentMood = moodForPost(framePosts[blend.currentPlaneIndex]);
      const nextMood = moodForPost(framePosts[blend.nextPlaneIndex] ?? framePosts[blend.currentPlaneIndex]);
      const mood = lerpMood(currentMood, nextMood, blend.depthBlend);
      const reduced = reducedRef.current;
      setAmbientReducedMotion(reduced);
      const depthProgress = getDepthProgress(state.cameraZ, planeCount);
      const velocityIntensity = Math.min(1, Math.abs(state.velocity) / VELOCITY_MAX);
      const painted = atmosphere.draw({
        mood,
        uTime: now - started,
        uVelocityIntensity: velocityIntensity,
        depthProgress,
        reducedMotion: reduced,
      });

      const fallback = fallbackRef.current;
      if (fallback) {
        fallback.style.background = painted.cssFallback;
        fallback.style.opacity = painted.usedCanvas && usedCanvas ? '0' : '1';
      }
      if (overlayCanvas) overlayCanvas.style.opacity = painted.usedCanvas && usedCanvas ? '1' : '0';

      applyChrome(mood.backgroundColor);

      const portrait = overlayRoot.clientHeight > overlayRoot.clientWidth;
      const baseScale = portrait ? PORTRAIT_STACK_SCALE : 1;
      const stack = stackRef.current;
      if (stack) stack.style.transform = `translate(-50%, -50%) scale(${baseScale})`;

      const drift = reduced ? 0 : state.velocity * 10;
      const tilt = reduced ? 0 : state.velocity * 0.4;
      const breath = reduced ? 0 : Math.sin((now - started) * 0.0012) * 0.008;
      const velScale = reduced ? 0 : Math.min(0.025, Math.abs(state.velocity) * 0.012);
      const garnishScale = 1 + breath + velScale;
      idle = stepGalleryIdle({
        now,
        lastNow: idle.lastNow,
        stillMs: idle.stillMs,
        idleAmount: idle.idleAmount,
        vanishAmount: idle.vanishAmount,
        velocity: state.velocity,
        scrollTarget: state.scrollTarget,
        scrollCurrent: state.scrollCurrent,
        reducedMotion: reduced,
      });

      const still = isGalleryScrollStill(state.velocity, state.scrollTarget, state.scrollCurrent);
      playbackDwell = stepGalleryPlaybackDwell({
        now,
        lastNow: playbackDwell.lastNow,
        stillMs: playbackDwell.stillMs,
        still,
      });
      const gallerySettled = playbackDwell.settled;
      const rippleReset = ornamentRippleShouldReset({ still, reducedMotion: reduced });
      const currentIndex = blend.currentPlaneIndex;
      const nextIndex = blend.nextPlaneIndex;
      const framePostsNow = postsRef.current;
      const currentPostId = framePostsNow[currentIndex]?.id || startPostId;
      const nextPostId = framePostsNow[nextIndex]?.id || null;
      const playPostId = galleryPlayPostId({
        currentPostId,
        nextPostId,
        depthBlend: blend.depthBlend,
      });
      const pairChanged =
        currentIndex !== lastNotifiedCurrent || nextIndex !== lastNotifiedNext;
      const settledChanged = gallerySettled !== lastNotifiedSettled;
      const playChanged = playPostId !== lastNotifiedPlay;
      if (pairChanged || settledChanged || playChanged) {
        lastNotifiedCurrent = currentIndex;
        lastNotifiedNext = nextIndex;
        lastNotifiedSettled = gallerySettled;
        lastNotifiedPlay = playPostId;
        startTransition(() => {
          onGalleryPlaybackChangeRef.current?.({
            currentPostId,
            nextPostId,
            settled: gallerySettled,
            depthBlend: blend.depthBlend,
          });
          if (pairChanged) {
            setPlanePair((prev) =>
              prev.current === currentIndex && prev.next === nextIndex
                ? prev
                : { current: currentIndex, next: nextIndex },
            );
          }
        });
      }
      const stackWidth = stack?.clientWidth ?? 0;
      const stackHeight = stack?.clientHeight ?? 0;
      const overlayWidth = overlayRoot.clientWidth;
      const overlayHeight = overlayRoot.clientHeight;
      const visualScale = portrait ? PORTRAIT_STACK_SCALE : 1;
      const offsets = computeGalleryOffsets({
        stackWidth,
        stackHeight,
        overlayWidth,
        isPortrait: portrait,
      });

      const { from, to } = galleryRenderWindow(currentIndex, nextIndex, planeCount);
      const orientations: Orientation[] = [];
      const orientFrom = Math.max(0, from - 1);
      const orientTo = Math.min(planeCount - 1, to + 1);
      for (let i = orientFrom; i <= orientTo; i++) {
        const post = framePosts[i];
        if (post) orientations[i] = getStableOrientation(post.id);
      }

      for (let i = from; i <= to; i++) {
        const post = framePosts[i];
        if (!post) continue;
        const layer = layerRefs.current.get(post.id);
        const visual = visualRefs.current.get(post.id);
        const isPair = i === currentIndex || i === nextIndex;
        const isImage = isCommunityImagePost(post);
        const isVideo = isCommunityVideoPost(post);
        const fallbackW =
          isImage || isVideo ? Number.parseInt(post.attachmentWidth || '', 10) || 0 : TEXT_CARD_FALLBACK.width;
        const fallbackH =
          isImage || isVideo ? Number.parseInt(post.attachmentHeight || '', 10) || 0 : TEXT_CARD_FALLBACK.height;
        const size =
          isImage || isVideo
            ? resolveIdleImageSize(
                visual instanceof HTMLImageElement || visual instanceof HTMLVideoElement ? visual : null,
                fallbackW,
                fallbackH,
              )
            : { width: TEXT_CARD_FALLBACK.width, height: TEXT_CARD_FALLBACK.height };
        const rect = containRectForStack(stackWidth, stackHeight, size.width, size.height);
        if (layer) {
          const motion = layerMotionForGalleryIndex({
            index: i,
            currentIndex,
            nextIndex,
            orientations,
            depthBlend: blend.depthBlend,
            reducedMotion: reduced,
            isPortrait: portrait,
            maxHorizontalOffset: offsets.maxHorizontalOffset,
            maxVerticalOffset: offsets.maxVerticalOffset,
          });
          layer.style.transform = layerTransformCss(motion);
          layer.style.zIndex = isPair ? '2' : '1';
          const clip = layer.querySelector('.community-depth-image-clip');
          if (clip instanceof HTMLElement) {
            clip.style.left = `${rect.left}px`;
            clip.style.top = `${rect.top}px`;
            clip.style.width = `${rect.width}px`;
            clip.style.height = `${rect.height}px`;
            clip.style.right = 'auto';
            clip.style.bottom = 'auto';
            const frameExpand = frameExpandScaleForOverlay(
              rect.width,
              rect.height,
              overlayWidth,
              overlayHeight,
              visualScale,
            );
            const clipScale = isPair ? composeIdleFrameScale(frameExpand, idle.idleAmount) : 1;
            clip.style.transform = `scale(${clipScale})`;
            const ambient = ambientRefs.current.get(post.id);
            if (ambient) {
              ambient.style.left = clip.style.left;
              ambient.style.top = clip.style.top;
              ambient.style.width = clip.style.width;
              ambient.style.height = clip.style.height;
              ambient.style.right = 'auto';
              ambient.style.bottom = 'auto';
              ambient.style.transform = clip.style.transform;
              ambient.style.opacity = String(opacities[i] ?? 0);
              const edge = Math.min(rect.width, rect.height);
              ambient.style.setProperty('--ambient-edge', `${edge}px`);
              ambient.style.setProperty('--ambient-spread', String(ambientSpreadScale(edge)));
              ambient.style.setProperty('--ambient-blur', `${ambientBlurPx(edge)}px`);
            }
          }
        }
        if (visual) {
          const coverScale =
            isPair && isImage ? coverScaleForStack(rect.width, rect.height, size.width, size.height) : 1;
          const scale = composeIdleImageScale(
            garnishScale,
            coverScale,
            isPair ? idle.idleAmount : 0,
          );
          visual.style.opacity = String(opacities[i] ?? 0);
          visual.style.transform = `translateX(${drift}px) rotate(${tilt}deg) scale(${scale})`;
        }
        const ornament = ornamentRefs.current.get(post.id);
        if (ornament) {
          const reveal = ornamentRevealForIndex(i, currentIndex, nextIndex, blend.depthBlend);
          ornament.style.opacity = String(ornamentOpacity(opacities[i] ?? 0, reveal, idle.vanishAmount));
          ornament.style.setProperty('--idle', String(isPair ? idle.idleAmount : 0));
        }
        const rippleRoot = rippleRefs.current.get(post.id);
        if (!rippleRoot) continue;
        if (rippleReset) {
          if (firedStartRipples.size === 0 && firedEndRipples.size === 0) continue;
          firedStartRipples.clear();
          firedEndRipples.clear();
          rippleRoot.querySelectorAll('.community-depth-ripple.is-firing').forEach((node) => {
            node.classList.remove('is-firing');
          });
          continue;
        }
        if (!(idle.vanishAmount > 0)) continue;
        const reveal = ornamentRevealForIndex(i, currentIndex, nextIndex, blend.depthBlend);
        const preVanishOpacity = ornamentOpacity(opacities[i] ?? 0, reveal, 0);
        const startReady = ornamentRippleShouldFireStart({
          still,
          reducedMotion: reduced,
          idleAmount: idle.idleAmount,
          vanishAmount: idle.vanishAmount,
          preVanishOpacity,
          alreadyFired: false,
        });
        const endReady = ornamentRippleShouldFire({
          still,
          reducedMotion: reduced,
          vanishAmount: idle.vanishAmount,
          preVanishOpacity,
          alreadyFired: false,
        });
        if (!startReady && !endReady) continue;
        rippleRoot.querySelectorAll('.community-depth-ripple').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const key = node.getAttribute('data-ripple-key');
          if (!key) return;
          const fireStart = ornamentRippleShouldFireStart({
            still,
            reducedMotion: reduced,
            idleAmount: idle.idleAmount,
            vanishAmount: idle.vanishAmount,
            preVanishOpacity,
            alreadyFired: firedStartRipples.has(key),
          });
          const fireEnd = ornamentRippleShouldFire({
            still,
            reducedMotion: reduced,
            vanishAmount: idle.vanishAmount,
            preVanishOpacity,
            alreadyFired: firedEndRipples.has(key),
          });
          if (!fireStart && !fireEnd) return;
          if (fireStart) firedStartRipples.add(key);
          if (fireEnd) firedEndRipples.add(key);
          if (node.classList.contains('is-firing')) {
            node.classList.remove('is-firing');
            void node.offsetWidth;
          }
          node.classList.add('is-firing');
        });
      }

      raf = requestAnimationFrame(frame);
    }

    function onKeyDown(event: KeyboardEvent) {
      const step = PLANE_GAP / SCROLL_TO_WORLD_FACTOR;
      if (event.key === 'Escape') return;
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'j') {
        event.preventDefault();
        scroll.scrollTarget += step;
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'k') {
        event.preventDefault();
        scroll.scrollTarget -= step;
      } else if (event.key === 'Home') {
        event.preventDefault();
        scroll.scrollTarget = scroll.minScroll;
      } else if (event.key === 'End') {
        event.preventDefault();
        scroll.scrollTarget = scroll.maxScroll;
      }
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        freezeAllAmbientSamplers();
        return;
      }
      if (running) {
        resumeAllAmbientSamplers();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    }

    root.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    root.focus();
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      freezeAllAmbientSamplers();
      root.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      scroll.dispose();
      atmosphere.dispose();
      if (scrollRef.current === scroll) scrollRef.current = null;
      if (layersRef.current === layers) layersRef.current = null;
    };
    // Mount once per overlay session. Length growth uses setPlaneCount above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPostId]);

  if (!posts.length) return null;

  const { from: mountFrom, to: mountTo } = galleryRenderWindow(
    planePair.current,
    planePair.next,
    posts.length,
  );
  const showEnd = shouldShowGalleryEnd({
    canLoadNextPage,
    isLoadingMore,
    loadMoreError,
    currentIndex: planePair.current,
    length: posts.length,
  });
  const showStatus = isLoadingMore || loadMoreError || showEnd;

  return (
    <div
      ref={rootRef}
      className="community-depth-gallery"
      role="dialog"
      aria-modal="true"
      aria-label={copy.galleryLabel}
      tabIndex={-1}
    >
      <div ref={fallbackRef} className="community-depth-fallback" aria-hidden="true" />
      <canvas ref={canvasRef} className="community-depth-canvas" aria-hidden="true" />
      <div ref={stackRef} className="community-depth-stack">
        {posts.slice(mountFrom, mountTo + 1).map((post, offset) => {
          const index = mountFrom + offset;
          const url = resolveChatAttachmentUrl(post);
          const isImage = isCommunityImagePost(post);
          const isVideo = isCommunityVideoPost(post);
          const isFile = String(post.attachmentKind || '').trim() === 'file';
          const eager = index === planePair.current || index === planePair.next;
          const mood = moodForPost(post);
          const onDark = relativeLuminance(mood.backgroundColor) < 0.5;
          return (
            <div
              key={post.id}
              className="community-depth-layer"
              ref={(el) => {
                if (el) layerRefs.current.set(post.id, el);
                else layerRefs.current.delete(post.id);
              }}
            >
              {isImage || isVideo ? (
                <CommunityDepthAmbient
                  active={eager}
                  kind={isVideo ? 'video' : 'image'}
                  reducedMotion={reducedMotion}
                  wrapperRef={(el) => {
                    if (el) ambientRefs.current.set(post.id, el);
                    else ambientRefs.current.delete(post.id);
                  }}
                />
              ) : null}
              <div className="community-depth-image-clip">
                {isImage ? (
                  <img
                    ref={(el) => {
                      if (el) visualRefs.current.set(post.id, el);
                      else visualRefs.current.delete(post.id);
                    }}
                    className="community-depth-image"
                    src={url}
                    alt={post.attachmentFileName || copy.photo}
                    width={Number.parseInt(post.attachmentWidth || '', 10) || undefined}
                    height={Number.parseInt(post.attachmentHeight || '', 10) || undefined}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    draggable={false}
                    style={{ opacity: index === startIndex ? 1 : 0 }}
                  />
                ) : isVideo ? (
                  <CommunityVideoPlayer
                    postId={post.id}
                    surface="gallery"
                    src={url}
                    width={Number.parseInt(post.attachmentWidth || '', 10) || undefined}
                    height={Number.parseInt(post.attachmentHeight || '', 10) || undefined}
                    visualRef={(el) => {
                      if (el) visualRefs.current.set(post.id, el);
                      else visualRefs.current.delete(post.id);
                    }}
                  />
                ) : (
                  <div
                    ref={(el) => {
                      if (el) visualRefs.current.set(post.id, el);
                      else visualRefs.current.delete(post.id);
                    }}
                    className={`community-depth-text-card${onDark ? ' community-depth-text-card--on-dark' : ' community-depth-text-card--on-light'}`}
                    style={{
                      background: `linear-gradient(160deg, ${mood.backgroundColor} 0%, ${mood.blob1Color} 58%, ${mood.blob2Color} 100%)`,
                      opacity: index === startIndex ? 1 : 0,
                    }}
                  >
                    {post.body.trim() ? (
                      <MessageBody body={post.body} candidates={[]} className="community-depth-text-body" />
                    ) : null}
                    {isFile ? (
                      <div className="community-depth-text-file">{post.attachmentFileName || copy.downloadFile}</div>
                    ) : null}
                  </div>
                )}
              </div>
              <div
                className="community-depth-ornaments"
                ref={(el) => {
                  if (el) ornamentRefs.current.set(post.id, el);
                  else ornamentRefs.current.delete(post.id);
                }}
                aria-hidden="true"
                style={{ opacity: index === startIndex ? 1 : 0 }}
              >
                <CommunityDepthOrnaments
                  post={post}
                  reactions={reactionsByPostId.get(post.id) ?? []}
                  comments={commentsByPostId.get(post.id) ?? []}
                  reactorProfiles={reactorProfiles}
                />
              </div>
              <div
                className="community-depth-ripples"
                ref={(el) => {
                  if (el) rippleRefs.current.set(post.id, el);
                  else rippleRefs.current.delete(post.id);
                }}
                aria-hidden="true"
              >
                <CommunityDepthRipples
                  post={post}
                  reactions={reactionsByPostId.get(post.id) ?? []}
                  comments={commentsByPostId.get(post.id) ?? []}
                  reactorProfiles={reactorProfiles}
                />
              </div>
            </div>
          );
        })}
      </div>
      {showStatus ? (
        <div className="community-depth-status" role="status">
          {isLoadingMore ? <span>{copy.loadingMore}</span> : null}
          {loadMoreError ? (
            <button type="button" className="community-depth-status-retry" onClick={() => onNeedMore?.()}>
              {copy.retry}
            </button>
          ) : null}
          {showEnd ? <span>{copy.galleryEnd}</span> : null}
        </div>
      ) : null}
      <button
        ref={closeRef}
        type="button"
        className="community-depth-close"
        onClick={exitToPost}
        aria-label={copy.backToPost}
      >
        {copy.backToPost}
      </button>
    </div>
  );
}
