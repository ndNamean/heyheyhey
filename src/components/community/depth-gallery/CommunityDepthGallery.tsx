import { useEffect, useMemo, useRef } from 'react';
import { useLang } from '../../../i18n';
import { resolveChatAttachmentUrl } from '../../../lib/chatAttachmentDisplay';
import { BACK_PRIORITY, useNativeBack } from '../../../lib/nativeBack';
import { usePointerCapabilities } from '../../media-interaction/pointerCapabilities';
import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import { AtmosphereCanvas } from './atmosphereCanvas';
import CommunityDepthOrnaments from './CommunityDepthOrnaments';
import {
  composeIdleImageScale,
  coverScaleForStack,
  resolveIdleImageSize,
  stepGalleryIdle,
} from './galleryIdle';
import { ornamentOpacity, ornamentRevealForIndex } from './galleryOrnaments';
import { resolveGalleryMood, parseMoodHex, interpolateMoods } from './moodController';
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
import { buildCommunityGalleryPosts } from './gallerySet';
import {
  PORTRAIT_STACK_SCALE,
  computeGalleryOffsets,
  getStableOrientation,
  layerMotionForGalleryIndex,
  layerTransformCss,
  type Orientation,
} from './rotationMotion';

export { COMMUNITY_GALLERY_MAX_PLANES, buildCommunityGalleryPosts, isCommunityImagePost } from './gallerySet';

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
}

export default function CommunityDepthGallery({
  sourcePosts,
  startPostId,
  onClose,
  reactionsByPostId = EMPTY_REACTIONS,
  commentsByPostId = EMPTY_COMMENTS,
  reactorProfiles = EMPTY_PROFILES,
}: Props) {
  const { t } = useLang();
  const copy = t.community;
  const { reducedMotion } = usePointerCapabilities();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const imageRefs = useRef<Array<HTMLImageElement | null>>([]);
  const ornamentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const currentPostIdRef = useRef(startPostId);

  const { posts, startIndex } = useMemo(
    () => buildCommunityGalleryPosts(sourcePosts, startPostId),
    [sourcePosts, startPostId],
  );
  const planeKey = posts.map((post) => post.id).join('|');

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
    if (!posts.length) {
      onCloseRef.current(startPostId);
      return;
    }

    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root) return;

    const overlayRoot = root;
    const overlayCanvas = canvas;
    const scroll = new ScrollController({ planeCount: posts.length });
    const layers = new GalleryLayers(posts.length);
    const atmosphere = new AtmosphereCanvas();
    const usedCanvas = overlayCanvas ? atmosphere.attach(overlayCanvas) : false;

    const targetZ = cameraZForPlaneIndex(startIndex);
    const startScroll = scroll.scrollFromCameraZ(targetZ);
    scroll.scrollTarget = startScroll;
    scroll.scrollCurrent = startScroll;
    scroll.previousScrollCurrent = startScroll;
    scroll.update();

    scroll.attach(root);
    currentPostIdRef.current = posts[startIndex]?.id || startPostId;

    const moods = posts.map((post) =>
      resolveGalleryMood({
        postId: post.id,
        moodBackgroundColor: post.moodBackgroundColor,
        moodBlob1Color: post.moodBlob1Color,
        moodBlob2Color: post.moodBlob2Color,
      }),
    );
    const orientations: Orientation[] = posts.map((post) => getStableOrientation(post.id));

    let raf = 0;
    let running = true;
    let chromeDark = relativeLuminance(moods[startIndex]?.backgroundColor ?? '#fffaf0') < 0.5;
    let idle = { lastNow: 0, stillMs: 0, idleAmount: 0 };
    const started = performance.now();

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
      const state = scroll.update(layers.getDepthRange());
      const blend = layers.getPlaneBlendData(state.cameraZ);
      currentPostIdRef.current = dominantGalleryPostId(posts, blend, startPostId);
      const opacities = layers.updateOpacities(state.cameraZ);
      const mood = interpolateMoods(moods, blend);
      const reduced = reducedRef.current;
      const depthProgress = getDepthProgress(state.cameraZ, posts.length);
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
        velocity: state.velocity,
        scrollTarget: state.scrollTarget,
        scrollCurrent: state.scrollCurrent,
        reducedMotion: reduced,
      });

      const currentIndex = blend.currentPlaneIndex;
      const nextIndex = blend.nextPlaneIndex;
      const stackWidth = stack?.clientWidth ?? 0;
      const stackHeight = stack?.clientHeight ?? 0;
      const offsets = computeGalleryOffsets({
        stackWidth,
        stackHeight,
        overlayWidth: overlayRoot.clientWidth,
        isPortrait: portrait,
      });

      for (let i = 0; i < posts.length; i++) {
        const layer = layerRefs.current[i];
        const img = imageRefs.current[i];
        const isPair = i === currentIndex || i === nextIndex;
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
        }
        if (img) {
          const post = posts[i];
          const fallbackW = Number.parseInt(post?.attachmentWidth || '', 10) || 0;
          const fallbackH = Number.parseInt(post?.attachmentHeight || '', 10) || 0;
          const size = resolveIdleImageSize(img, fallbackW, fallbackH);
          const coverScale = isPair
            ? coverScaleForStack(stackWidth, stackHeight, size.width, size.height)
            : 1;
          const scale = composeIdleImageScale(
            garnishScale,
            coverScale,
            isPair ? idle.idleAmount : 0,
          );
          img.style.opacity = String(opacities[i] ?? 0);
          img.style.transform = `translateX(${drift}px) rotate(${tilt}deg) scale(${scale})`;
        }
        const ornament = ornamentRefs.current[i];
        if (ornament) {
          const reveal = ornamentRevealForIndex(i, currentIndex, nextIndex, blend.depthBlend);
          ornament.style.opacity = String(ornamentOpacity(opacities[i] ?? 0, reveal));
          ornament.style.setProperty('--idle', String(isPair ? idle.idleAmount : 0));
        }
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
        return;
      }
      if (running) {
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
      root.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      scroll.dispose();
      atmosphere.dispose();
    };
  }, [planeKey, posts, startIndex]);

  if (!posts.length) return null;

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
        {posts.map((post, index) => {
          const url = resolveChatAttachmentUrl(post);
          const eager = Math.abs(index - startIndex) <= 1;
          return (
            <div
              key={post.id}
              className="community-depth-layer"
              ref={(el) => {
                layerRefs.current[index] = el;
              }}
            >
              <div className="community-depth-image-clip">
                <img
                  ref={(el) => {
                    imageRefs.current[index] = el;
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
              </div>
              <div
                className="community-depth-ornaments"
                ref={(el) => {
                  ornamentRefs.current[index] = el;
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
            </div>
          );
        })}
      </div>
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
