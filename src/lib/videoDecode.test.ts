// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeVideoMetadata, videoDecodeIsAvailable } from './videoDecode';

describe('videoDecode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips in jsdom', () => {
    expect(videoDecodeIsAvailable()).toBe(false);
  });

  it('returns unprocessable when metadata cannot load', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    });
    class BoomVideo {
      preload = '';
      muted = false;
      playsInline = false;
      videoWidth = 0;
      videoHeight = 0;
      duration = Number.NaN;
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause() {}
      load() {}
      removeAttribute() {}
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return new BoomVideo() as unknown as HTMLVideoElement;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });
    if (typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
      });
    }
    const result = await decodeVideoMetadata(new Blob(['nope'], { type: 'video/mp4' }));
    expect(result.status).toBe('unprocessable');
  });

  it('returns too_long when duration exceeds 30s', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    });
    class LongVideo {
      preload = '';
      muted = false;
      playsInline = false;
      videoWidth = 640;
      videoHeight = 360;
      duration = 31;
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause() {}
      load() {}
      removeAttribute() {}
      set src(_value: string) {
        queueMicrotask(() => this.onloadedmetadata?.());
      }
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return new LongVideo() as unknown as HTMLVideoElement;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });
    if (typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
      });
    }
    const result = await decodeVideoMetadata(new Blob(['clip'], { type: 'video/mp4' }));
    expect(result.status).toBe('too_long');
  });

  it('returns ok metadata for a short clip', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    });
    class OkVideo {
      preload = '';
      muted = false;
      playsInline = false;
      videoWidth = 1920;
      videoHeight = 1080;
      duration = 12.4;
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause() {}
      load() {}
      removeAttribute() {}
      set src(_value: string) {
        queueMicrotask(() => this.onloadedmetadata?.());
      }
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return new OkVideo() as unknown as HTMLVideoElement;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });
    if (typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
      });
    }
    const result = await decodeVideoMetadata(new Blob(['clip'], { type: 'video/mp4' }));
    expect(result).toEqual({
      status: 'ok',
      width: 1920,
      height: 1080,
      duration: 12.4,
    });
  });
});
