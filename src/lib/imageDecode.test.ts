// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { decodeImageDimensions, imageDecodeIsAvailable } from './imageDecode';
import {
  ATTACHMENT_TOO_LARGE_COPY,
  assertJsonFitsFunctionBody,
  grantPayloadHasFileBytes,
} from './vercelFunctionJsonBudget';

describe('vercelFunctionJsonBudget', () => {
  it('rejects leftover fileBase64 before any fetch', () => {
    expect(grantPayloadHasFileBytes({ fileBase64: 'aaaa' })).toBe(true);
    expect(() =>
      assertJsonFitsFunctionBody({ mimeType: 'image/jpeg', fileBase64: 'aaaa' }),
    ).toThrow(ATTACHMENT_TOO_LARGE_COPY);
  });
});

describe('imageDecode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips when Image is unavailable', () => {
    vi.stubGlobal('Image', undefined);
    expect(imageDecodeIsAvailable()).toBe(false);
  });

  it('treats decode onerror as unprocessable', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    });
    class BoomImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BoomImage);
    if (typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
      });
    }
    const result = await decodeImageDimensions(new Blob(['nope'], { type: 'image/jpeg' }));
    expect(result.status).toBe('unprocessable');
  });
});
