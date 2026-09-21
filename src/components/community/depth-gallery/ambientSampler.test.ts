// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AMBIENT_BUFFER_MAX,
  AMBIENT_BUFFER_MIN,
  AMBIENT_REVEAL_MS,
  AMBIENT_SPREAD,
  AMBIENT_SPREAD_MAX_PX,
  AMBIENT_SPREAD_MIN_PX,
  AMBIENT_VIDEO_HZ,
  ambientBlurPx,
  ambientBufferSize,
  ambientLiveIntervalCount,
  ambientLiveSamplerCount,
  ambientSpreadScale,
  createAmbientSampler,
  disposeAllAmbientSamplers,
  findAmbientMedia,
  freezeAllAmbientSamplers,
  resumeAllAmbientSamplers,
  setAmbientReducedMotion,
} from './ambientSampler';

type Ctx = {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
};

let ctx: Ctx;
let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

function installCanvasMock(overrides?: Partial<Ctx>) {
  ctx = {
    drawImage: overrides?.drawImage ?? vi.fn(),
    getImageData: overrides?.getImageData ?? vi.fn(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    }),
    clearRect: overrides?.clearRect ?? vi.fn(),
  };
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
  return ctx;
}

function fakeImage(width = 800, height = 600) {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => height });
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
  img.decode = () => Promise.resolve();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  return img;
}

function fakeVideo(state: { playing: boolean; readyState: number; width?: number; height?: number }) {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => state.width ?? 1280,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => state.height ?? 720,
  });
  Object.defineProperty(video, 'readyState', {
    configurable: true,
    get: () => state.readyState,
  });
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => !state.playing,
  });
  return video;
}

async function microtasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ambientSampler', () => {
  beforeEach(() => {
    installCanvasMock();
    setAmbientReducedMotion(false);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  afterEach(() => {
    disposeAllAmbientSamplers();
    getContextSpy?.mockRestore();
    getContextSpy = null;
    vi.useRealTimers();
    setAmbientReducedMotion(false);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('keeps the 32–64px buffer family and 5Hz / 220ms constants', () => {
    expect(AMBIENT_BUFFER_MIN).toBe(32);
    expect(AMBIENT_BUFFER_MAX).toBe(64);
    expect(AMBIENT_VIDEO_HZ).toBe(5);
    expect(AMBIENT_REVEAL_MS).toBe(220);
    const landscape = ambientBufferSize(1600, 900);
    const portrait = ambientBufferSize(900, 1600);
    const square = ambientBufferSize(400, 400);
    expect(landscape).toEqual({ width: 64, height: 36 });
    expect(portrait).toEqual({ width: 36, height: 64 });
    expect(square).toEqual({ width: 64, height: 64 });
    expect(Math.max(landscape!.width, landscape!.height)).toBeLessThanOrEqual(64);
    expect(Math.max(landscape!.width, landscape!.height)).toBeGreaterThanOrEqual(32);
    expect(ambientBufferSize(0, 10)).toBeNull();
  });

  it('clamps spread and blur from the shortest edge', () => {
    expect(AMBIENT_SPREAD).toBe(0.32);
    expect(ambientSpreadScale(50)).toBeCloseTo(1 + AMBIENT_SPREAD_MIN_PX / 50, 5);
    expect(ambientSpreadScale(400)).toBeCloseTo(1 + AMBIENT_SPREAD_MAX_PX / 400, 5);
    expect(ambientSpreadScale(300)).toBeCloseTo(1 + 0.32, 5);
    expect(ambientBlurPx(50)).toBe(12);
    expect(ambientBlurPx(400)).toBe(40);
  });

  it('finds img/video in the clip sibling and ignores other nodes', () => {
    const host = document.createElement('div');
    const clip = document.createElement('div');
    clip.className = 'community-depth-image-clip';
    const img = document.createElement('img');
    img.className = 'community-depth-image';
    clip.appendChild(img);
    host.insertAdjacentElement('afterend', clip);
    const wrap = document.createElement('div');
    wrap.append(host, clip);
    expect(findAmbientMedia(host, 'image')).toBe(img);
    expect(findAmbientMedia(host, 'video')).toBeNull();
    const video = document.createElement('video');
    clip.appendChild(video);
    expect(findAmbientMedia(host, 'video')).toBe(video);
  });

  it('samples a static image once and reveals', async () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const img = fakeImage();
    sampler.bindImage(img);
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage.mock.calls[0][3]).toBe(64);
    expect(ctx.drawImage.mock.calls[0][4]).toBe(48);
    expect(host.getAttribute('data-ready')).toBe('');
    img.dispatchEvent(new Event('load'));
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('resamples when image src changes', async () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const img = fakeImage();
    sampler.bindImage(img);
    await microtasks();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.dispatchEvent(new Event('load'));
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it('disables on decode failure without throwing', async () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const img = fakeImage();
    img.decode = () => Promise.reject(new Error('decode'));
    sampler.bindImage(img);
    await microtasks();
    expect(sampler.disabled).toBe(true);
    expect(host.getAttribute('data-ready')).toBeNull();
    expect(host.querySelector('canvas')).toBeTruthy();
  });

  it('disables on drawImage throw and leaves a blank canvas', async () => {
    ctx.drawImage.mockImplementation(() => {
      throw new DOMException('tainted', 'SecurityError');
    });
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    sampler.bindImage(fakeImage());
    await microtasks();
    expect(sampler.disabled).toBe(true);
    expect(host.getAttribute('data-ready')).toBeNull();
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it('reveals a painted canvas even when pixel reads would throw CORS', async () => {
    ctx.getImageData.mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    sampler.bindImage(fakeImage());
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(sampler.disabled).toBe(false);
    expect(host.getAttribute('data-ready')).toBe('');
    expect(host.querySelector('canvas')).toBeTruthy();
  });

  it('ignores a late decode after dispose', async () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    let resolveDecode: () => void = () => {};
    const img = fakeImage();
    img.decode = () =>
      new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });
    sampler.bindImage(img);
    sampler.dispose();
    resolveDecode();
    await microtasks();
    expect(host.getAttribute('data-ready')).toBeNull();
    expect(host.querySelector('canvas')).toBeNull();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('does not sample video before readyState >= 2', () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: true, readyState: 0 });
    sampler.bindVideo(video);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(host.getAttribute('data-ready')).toBeNull();
    expect(sampler.intervalActive).toBe(false);
  });

  it('samples the first video frame when readyState >= 2', () => {
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: false, readyState: 2 });
    sampler.bindVideo(video);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.getAttribute('data-ready')).toBe('');
    expect(sampler.intervalActive).toBe(false);
  });

  it('throttles playing video to ~5fps and freezes when paused', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const state = { playing: true, readyState: 2 };
    const video = fakeVideo(state);
    sampler.bindVideo(video);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage.mock.calls.length).toBe(6);
    expect(ambientLiveIntervalCount()).toBe(1);
    state.playing = false;
    video.dispatchEvent(new Event('pause'));
    const frozen = ctx.drawImage.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage.mock.calls.length).toBe(frozen);
    expect(sampler.intervalActive).toBe(false);
    expect(host.getAttribute('data-ready')).toBe('');
  });

  it('does not reset the reveal when a looping video keeps playing', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: true, readyState: 2 });
    sampler.bindVideo(video);
    expect(host.getAttribute('data-ready')).toBe('');
    video.dispatchEvent(new Event('ended'));
    video.dispatchEvent(new Event('playing'));
    expect(host.getAttribute('data-ready')).toBe('');
    expect(sampler.intervalActive).toBe(true);
    vi.advanceTimersByTime(400);
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(1);
  });

  it('freezes intervals when the document is hidden and resumes if still eligible', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: true, readyState: 2 });
    sampler.bindVideo(video);
    expect(ambientLiveIntervalCount()).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    freezeAllAmbientSamplers();
    expect(ambientLiveIntervalCount()).toBe(0);
    const frozen = ctx.drawImage.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage.mock.calls.length).toBe(frozen);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    resumeAllAmbientSamplers();
    expect(ambientLiveIntervalCount()).toBe(1);
  });

  it('keeps a static first video frame under reduced motion', () => {
    vi.useFakeTimers();
    setAmbientReducedMotion(true);
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: true, readyState: 2 });
    sampler.bindVideo(video);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(sampler.intervalActive).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.getAttribute('data-ready')).toBe('');
  });

  it('stops sampling after leave-pair dispose', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const sampler = createAmbientSampler(host);
    const video = fakeVideo({ playing: true, readyState: 2 });
    sampler.bindVideo(video);
    expect(ambientLiveSamplerCount()).toBe(1);
    sampler.dispose();
    expect(ambientLiveIntervalCount()).toBe(0);
    expect(ambientLiveSamplerCount()).toBe(0);
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.getAttribute('data-ready')).toBeNull();
    const calls = ctx.drawImage.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage.mock.calls.length).toBe(calls);
  });

  it('caps live video intervals at two samplers when only two are playing', () => {
    vi.useFakeTimers();
    const a = createAmbientSampler(document.createElement('div'));
    const b = createAmbientSampler(document.createElement('div'));
    a.bindVideo(fakeVideo({ playing: true, readyState: 2 }));
    b.bindVideo(fakeVideo({ playing: true, readyState: 2 }));
    expect(ambientLiveIntervalCount()).toBe(2);
    expect(ambientLiveIntervalCount()).toBeLessThanOrEqual(2);
  });

  it('does not call play or pause on the video element', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const sampler = createAmbientSampler(document.createElement('div'));
    sampler.bindVideo(fakeVideo({ playing: true, readyState: 2 }));
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });
});
