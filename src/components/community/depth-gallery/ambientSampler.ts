/** Tiny Canvas-2D snapshots for gallery ambient. Does not feed mood / atmosphere / chrome. */

export const AMBIENT_BUFFER_MAX = 64;
export const AMBIENT_BUFFER_MIN = 32;
export const AMBIENT_VIDEO_HZ = 5;
export const AMBIENT_SPREAD = 0.32;
export const AMBIENT_SPREAD_MIN_PX = 24;
export const AMBIENT_SPREAD_MAX_PX = 96;
export const AMBIENT_BLUR_FRACTION = 0.16;
export const AMBIENT_BLUR_MIN_PX = 12;
export const AMBIENT_BLUR_MAX_PX = 40;
/** Matches IDLE_DWELL_MS. Do not reuse CHROME_HIDE_MS. */
export const AMBIENT_REVEAL_MS = 220;

const VIDEO_INTERVAL_MS = 1000 / AMBIENT_VIDEO_HZ;
const HAVE_CURRENT_DATA = 2;

const liveSamplers = new Set<AmbientSampler>();
let liveIntervals = 0;
let galleryReducedMotion = false;

export type AmbientKind = 'image' | 'video';

export type AmbientSampler = {
  readonly host: HTMLElement;
  readonly disabled: boolean;
  readonly intervalActive: boolean;
  setReducedMotion(value: boolean): void;
  bindImage(img: HTMLImageElement): void;
  bindVideo(video: HTMLVideoElement): void;
  freeze(): void;
  resumeIfEligible(): void;
  dispose(): void;
};

export function ambientLiveIntervalCount(): number {
  return liveIntervals;
}

export function ambientLiveSamplerCount(): number {
  return liveSamplers.size;
}

export function setAmbientReducedMotion(value: boolean): void {
  const next = Boolean(value);
  if (galleryReducedMotion === next) return;
  galleryReducedMotion = next;
  for (const sampler of liveSamplers) sampler.setReducedMotion(next);
}

export function freezeAllAmbientSamplers(): void {
  for (const sampler of liveSamplers) sampler.freeze();
}

export function resumeAllAmbientSamplers(): void {
  for (const sampler of liveSamplers) sampler.resumeIfEligible();
}

export function disposeAllAmbientSamplers(): void {
  for (const sampler of [...liveSamplers]) sampler.dispose();
}

export function ambientBufferSize(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } | null {
  const w = Number(sourceWidth);
  const h = Number(sourceHeight);
  const long = Math.max(w, h);
  if (!(w > 0 && h > 0 && long > 0) || !Number.isFinite(long)) return null;
  const scale = AMBIENT_BUFFER_MAX / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function ambientSpreadScale(edgePx: number): number {
  if (!(edgePx > 0) || !Number.isFinite(edgePx)) return 1 + AMBIENT_SPREAD;
  const spreadPx = Math.min(AMBIENT_SPREAD_MAX_PX, Math.max(AMBIENT_SPREAD_MIN_PX, AMBIENT_SPREAD * edgePx));
  return 1 + spreadPx / edgePx;
}

export function ambientBlurPx(edgePx: number): number {
  if (!(edgePx > 0) || !Number.isFinite(edgePx)) return AMBIENT_BLUR_MIN_PX;
  return Math.min(AMBIENT_BLUR_MAX_PX, Math.max(AMBIENT_BLUR_MIN_PX, AMBIENT_BLUR_FRACTION * edgePx));
}

export function findAmbientMedia(
  host: HTMLElement,
  kind: AmbientKind,
): HTMLImageElement | HTMLVideoElement | null {
  const clip = host.nextElementSibling;
  if (!(clip instanceof HTMLElement) || !clip.classList.contains('community-depth-image-clip')) {
    return null;
  }
  if (kind === 'image') {
    const img = clip.querySelector('img.community-depth-image, img');
    return img instanceof HTMLImageElement ? img : null;
  }
  const video = clip.querySelector('video');
  return video instanceof HTMLVideoElement ? video : null;
}

function sourceSize(source: HTMLImageElement | HTMLVideoElement): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.naturalWidth, height: source.naturalHeight };
}

export function createAmbientSampler(host: HTMLElement): AmbientSampler {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let disabled = false;
  let reduced = galleryReducedMotion;
  let generation = 0;
  let intervalId = 0;
  let video: HTMLVideoElement | null = null;
  let sampledSrc = '';
  let unbindMedia: (() => void) | null = null;

  function stopInterval() {
    if (!intervalId) return;
    window.clearInterval(intervalId);
    intervalId = 0;
    liveIntervals = Math.max(0, liveIntervals - 1);
  }

  function blankCanvas() {
    if (!canvas) return;
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch {
      try {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        /* ignore */
      }
    }
  }

  function disable() {
    disabled = true;
    stopInterval();
    blankCanvas();
    host.removeAttribute('data-ready');
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'community-depth-ambient-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    try {
      const next = canvas.getContext('2d');
      ctx = next && 'drawImage' in next ? (next as CanvasRenderingContext2D) : null;
    } catch {
      ctx = null;
    }
    if (!ctx) disable();
  }

  function markReady() {
    if (disabled) return;
    host.setAttribute('data-ready', '');
  }

  function paint(source: HTMLImageElement | HTMLVideoElement): boolean {
    if (disabled) return false;
    const size = sourceSize(source);
    const buf = ambientBufferSize(size.width, size.height);
    if (!buf) return false;
    ensureCanvas();
    if (disabled || !canvas || !ctx) return false;
    try {
      if (canvas.width !== buf.width) canvas.width = buf.width;
      if (canvas.height !== buf.height) canvas.height = buf.height;
      ctx.drawImage(source, 0, 0, buf.width, buf.height);
      return true;
    } catch {
      disable();
      return false;
    }
  }

  function clearMediaListeners() {
    unbindMedia?.();
    unbindMedia = null;
    video = null;
  }

  function sampleImage(img: HTMLImageElement, gen: number, src: string) {
    if (generation !== gen || disabled) return;
    if (src && src === sampledSrc && host.hasAttribute('data-ready')) return;
    if (paint(img)) {
      sampledSrc = src;
      markReady();
    }
  }

  function startImage(img: HTMLImageElement, gen: number) {
    if (generation !== gen || disabled) return;
    if (!img.complete || !(img.naturalWidth > 0)) return;
    const src = img.currentSrc || img.src || '';
    const decode =
      typeof img.decode === 'function' ? img.decode() : Promise.resolve();
    void decode.then(
      () => sampleImage(img, gen, src),
      () => {
        if (generation !== gen) return;
        disable();
      },
    );
  }

  function sampleVideoFrame() {
    if (disabled || !video) return;
    if (video.readyState < HAVE_CURRENT_DATA) return;
    if (paint(video)) markReady();
  }

  function syncLoop() {
    if (disabled || reduced || document.hidden || !video || video.paused) {
      stopInterval();
      return;
    }
    if (intervalId) return;
    intervalId = window.setInterval(() => {
      if (disabled || reduced || document.hidden || !video || video.paused) {
        stopInterval();
        return;
      }
      sampleVideoFrame();
    }, VIDEO_INTERVAL_MS);
    liveIntervals += 1;
  }

  const api: AmbientSampler = {
    host,
    get disabled() {
      return disabled;
    },
    get intervalActive() {
      return intervalId !== 0;
    },
    setReducedMotion(value: boolean) {
      const next = Boolean(value);
      if (reduced === next) return;
      reduced = next;
      if (reduced) stopInterval();
      else syncLoop();
    },
    bindImage(img: HTMLImageElement) {
      if (disabled) return;
      clearMediaListeners();
      sampledSrc = '';
      const gen = ++generation;
      const onLoad = () => startImage(img, gen);
      const onError = () => {
        if (generation !== gen) return;
        disable();
      };
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      unbindMedia = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };
      startImage(img, gen);
    },
    bindVideo(el: HTMLVideoElement) {
      if (disabled) return;
      clearMediaListeners();
      video = el;
      const gen = ++generation;
      const onReady = () => {
        if (generation !== gen || disabled) return;
        sampleVideoFrame();
        syncLoop();
      };
      const onPause = () => {
        if (generation !== gen || disabled) return;
        stopInterval();
      };
      el.addEventListener('loadeddata', onReady);
      el.addEventListener('playing', onReady);
      el.addEventListener('pause', onPause);
      unbindMedia = () => {
        el.removeEventListener('loadeddata', onReady);
        el.removeEventListener('playing', onReady);
        el.removeEventListener('pause', onPause);
      };
      if (el.readyState >= HAVE_CURRENT_DATA) onReady();
    },
    freeze() {
      stopInterval();
    },
    resumeIfEligible() {
      if (disabled) return;
      syncLoop();
    },
    dispose() {
      generation += 1;
      stopInterval();
      clearMediaListeners();
      host.removeAttribute('data-ready');
      if (canvas && canvas.parentNode === host) {
        host.removeChild(canvas);
      }
      canvas = null;
      ctx = null;
      liveSamplers.delete(api);
    },
  };

  ensureCanvas();
  liveSamplers.add(api);
  return api;
}
