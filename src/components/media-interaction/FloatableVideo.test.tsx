// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatableVideo from './FloatableVideo';
import { VIDEO_FLOAT } from './useVideoFloat';

function installMatchMedia(opts: { fineHover?: boolean; reducedMotion?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      const isMotion = query.includes('prefers-reduced-motion');
      const isHover = query.includes('pointer: fine');
      return {
        matches: isMotion ? Boolean(opts.reducedMotion) : isHover ? Boolean(opts.fineHover) : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

describe('FloatableVideo', () => {
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installMatchMedia({ fineHover: true });
    play = vi.fn(function (this: HTMLVideoElement) {
      Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    pause = vi.fn(function (this: HTMLVideoElement) {
      Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
      this.dispatchEvent(new Event('pause'));
    });
    HTMLMediaElement.prototype.play = play as typeof HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.pause = pause as typeof HTMLMediaElement.prototype.pause;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('wraps video without role=button and without a tap handler on video', () => {
    render(
      <FloatableVideo>
        <video data-testid="player" controls playsInline preload="metadata" />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float');
    const video = screen.getByTestId('player');
    expect(root?.getAttribute('role')).toBeNull();
    expect(video.closest('[role="button"]')).toBeNull();
    fireEvent.click(video);
    expect(root?.getAttribute('data-float-state')).toBe('resting');
  });

  it('plays once on enter, never on pointermove, pauses interaction-owned on leave', async () => {
    render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float') as HTMLElement;
    fireEvent.pointerEnter(root);
    await act(async () => undefined);
    expect(play).toHaveBeenCalledTimes(1);
    expect(root.getAttribute('data-playback-owner')).toBe('interaction');
    expect(root.getAttribute('data-float-state')).toBe('base');

    fireEvent.pointerMove(root);
    fireEvent.pointerMove(root);
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(root);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(root.getAttribute('data-float-state')).toBe('resting');
    expect(root.getAttribute('data-playback-owner')).toBe('none');
  });

  it('does not pause after user unmute (owner=user)', async () => {
    render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float') as HTMLElement;
    const video = screen.getByTestId('player') as HTMLVideoElement;
    fireEvent.pointerEnter(root);
    await act(async () => undefined);
    await act(async () => {
      video.muted = false;
      video.dispatchEvent(new Event('volumechange'));
    });
    expect(root.getAttribute('data-playback-owner')).toBe('user');
    fireEvent.pointerLeave(root);
    expect(pause).not.toHaveBeenCalled();
  });

  it('does not resume after user pause', async () => {
    render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float') as HTMLElement;
    const video = screen.getByTestId('player') as HTMLVideoElement;
    fireEvent.pointerEnter(root);
    await act(async () => undefined);
    play.mockClear();
    video.dispatchEvent(new Event('pause'));
    fireEvent.pointerLeave(root);
    fireEvent.pointerEnter(root);
    await act(async () => undefined);
    expect(play).not.toHaveBeenCalled();
  });

  it('swallows play() NotAllowedError and leaves owner none', async () => {
    play.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })),
    );
    render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    fireEvent.pointerEnter(document.querySelector('.media-float') as HTMLElement);
    await act(async () => undefined);
    expect(document.querySelector('.media-float')?.getAttribute('data-playback-owner')).toBe('none');
  });

  it('does not float under reduced motion or when disabled', () => {
    installMatchMedia({ fineHover: true, reducedMotion: true });
    const { rerender } = render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float') as HTMLElement;
    fireEvent.pointerEnter(root);
    expect(root.getAttribute('data-float-state')).toBe('resting');
    expect(play).not.toHaveBeenCalled();

    installMatchMedia({ fineHover: true, reducedMotion: false });
    rerender(
      <FloatableVideo enableFloat={false}>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const disabled = document.querySelector('.media-float') as HTMLElement;
    fireEvent.pointerEnter(disabled);
    expect(disabled.getAttribute('data-float-state')).toBe('resting');
    expect(disabled.getAttribute('data-float-enabled')).toBe('false');
  });

  it('idle enhances then move returns to base; Space on video does not toggle', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <FloatableVideo>
        <video data-testid="player" controls />
      </FloatableVideo>,
    );
    const root = document.querySelector('.media-float') as HTMLElement;
    const video = screen.getByTestId('player');
    fireEvent.pointerEnter(root);
    act(() => {
      vi.advanceTimersByTime(VIDEO_FLOAT.IDLE_MS);
    });
    expect(root.getAttribute('data-float-state')).toBe('enhanced');
    fireEvent.pointerMove(root);
    expect(root.getAttribute('data-float-state')).toBe('base');
    fireEvent.keyDown(video, { key: ' ' });
    expect(root.getAttribute('data-float-state')).toBe('base');
  });
});
