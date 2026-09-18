// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { CommunityVideoPlaybackProvider } from './CommunityVideoPlayback';
import { CommunityVideoPlayer } from './CommunityVideoPlayer';

/** Device checks still required: iOS Safari / Android Chrome unmuted autoplay, Low Power Mode, iOS inline+mute fallback, unmute after muted autoplay. */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(HTMLMediaElement.prototype.play).mockReset();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => Promise.resolve());
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
});

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

const src = 'https://example.com/clip.mp4';

function chromeControls() {
  return document.querySelector('.community-video-controls') as HTMLElement;
}

function tapFrame(frame: HTMLElement, x = 10, y = 10) {
  fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(frame, { pointerId: 1, clientX: x + 2, clientY: y + 1 });
}

function renderPlayer(
  props: Partial<ComponentProps<typeof CommunityVideoPlayer>> = {},
  withProvider = false,
) {
  const player = (
    <CommunityVideoPlayer postId="p1" surface="feed" src={src} {...props} />
  );
  if (!withProvider) return render(player);
  return render(
    <CommunityVideoPlaybackProvider
      overlayOpen={false}
      selectedPostId={null}
      composerOpen={false}
      gallery={null}
    >
      {player}
    </CommunityVideoPlaybackProvider>,
  );
}

describe('CommunityVideoPlayer', () => {
  it('uses stored aspect ratio, contain class, and native loop', () => {
    renderPlayer({ width: 1080, height: 1920, canAttachSource: true });
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.className).toContain('community-card-video-el');
    expect(document.querySelector('.community-card-image')).toBeNull();
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('1080 / 1920');
  });

  it('falls back to 16/9 and attaches src only when allowed', () => {
    const { rerender } = render(<CommunityVideoPlayer postId="p1" surface="feed" src={src} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBeNull();
    expect(document.querySelector('.community-card-video-frame') as HTMLElement).toHaveProperty(
      'style.aspectRatio',
      '16 / 9',
    );

    rerender(
      <CommunityVideoPlayer postId="p1" surface="feed" src={src} canAttachSource />,
    );
    expect((document.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(src);
  });

  it('does not show Play on first view when this instance is not the token', () => {
    renderPlayer({ canAttachSource: true });
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull();
    expect(screen.getByRole('slider', { name: /video/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeTruthy();
  });

  it('does not show Play while autoplay is pending or playing', () => {
    renderPlayer({ canAttachSource: true, wantPlay: true });
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('loops natively and does not show Replay after ended', () => {
    renderPlayer({ canAttachSource: true, wantPlay: true });
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(true);
    fireEvent.ended(video);
    expect(screen.queryByRole('button', { name: /replay/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('shows Play when autoplay is blocked and starts from the click', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('NotAllowedError'));
    renderPlayer({ canAttachSource: true, wantPlay: true });
    const playBtn = await screen.findByRole('button', { name: /^play$/i });
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValue(undefined);
    fireEvent.click(playBtn);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('shows Play after a low-movement tap pauses the active video', async () => {
    renderPlayer({ canAttachSource: true, wantPlay: true }, true);
    const video = document.querySelector('video') as HTMLVideoElement;
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    fireEvent.play(video);
    fireEvent.pointerMove(frame, { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 });
    tapFrame(frame);
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeTruthy();
  });

  it('does not pause when pointer movement exceeds the tap threshold', () => {
    renderPlayer({ canAttachSource: true, wantPlay: true }, true);
    const video = document.querySelector('video') as HTMLVideoElement;
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    fireEvent.play(video);
    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('retries muted play once if unmuted autoplay rejects', async () => {
    const play = vi
      .mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    renderPlayer({ canAttachSource: true, wantPlay: true });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^unmute$/i })).toBeTruthy();
  });

  it('lets Unmute start a gesture play after muted autoplay fallback', async () => {
    const play = vi
      .mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValue(undefined);
    renderPlayer({ canAttachSource: true, wantPlay: true }, true);
    const unmute = await screen.findByRole('button', { name: /^unmute$/i });
    play.mockClear();
    fireEvent.click(unmute);
    expect(play).toHaveBeenCalled();
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.muted).toBe(false);
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeTruthy();
  });

  it('pauses if play() fulfills after the generation is stale', async () => {
    let resolvePlay: (value?: unknown) => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const { rerender } = render(
      <CommunityVideoPlayer postId="p1" surface="feed" src={src} canAttachSource wantPlay />,
    );
    const pauseSpy = vi.mocked(HTMLMediaElement.prototype.pause);
    const callsAfterGrant = pauseSpy.mock.calls.length;

    rerender(
      <CommunityVideoPlayer postId="p1" surface="feed" src={src} canAttachSource wantPlay={false} />,
    );
    const callsAfterLoss = pauseSpy.mock.calls.length;
    expect(callsAfterLoss).toBeGreaterThan(callsAfterGrant);

    resolvePlay();
    await waitFor(() => {
      expect(pauseSpy.mock.calls.length).toBeGreaterThan(callsAfterLoss);
    });
  });

  it('stops control gestures from bubbling', () => {
    const onBubble = vi.fn();
    render(
      <div onPointerDown={onBubble}>
        <CommunityVideoPlayer postId="p1" surface="feed" src={src} canAttachSource />
      </div>,
    );
    fireEvent.pointerDown(document.querySelector('.community-video-controls') as HTMLElement);
    expect(onBubble).not.toHaveBeenCalled();
  });

  it('starts chrome hiding on play without a Play overlay', () => {
    renderPlayer({ canAttachSource: true, wantPlay: true });
    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.play(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('hiding');
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('sets chrome hidden after the 1s fade timeout', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderPlayer({ canAttachSource: true, wantPlay: true });
    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.play(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('hiding');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(chromeControls().getAttribute('data-chrome')).toBe('hidden');
  });

  it('reveals chrome on a hidden-frame tap without pausing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderPlayer({ canAttachSource: true, wantPlay: true }, true);
    const video = document.querySelector('video') as HTMLVideoElement;
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    fireEvent.play(video);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(chromeControls().getAttribute('data-chrome')).toBe('hidden');
    tapFrame(frame);
    expect(chromeControls().getAttribute('data-chrome')).toBe('visible');
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('pauses on tap while chrome is visible', async () => {
    renderPlayer({ canAttachSource: true, wantPlay: true }, true);
    const video = document.querySelector('video') as HTMLVideoElement;
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    fireEvent.play(video);
    fireEvent.pointerMove(frame, { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 });
    expect(chromeControls().getAttribute('data-chrome')).toBe('visible');
    tapFrame(frame);
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeTruthy();
  });

  it('keeps chrome visible on pause and error', () => {
    renderPlayer({ canAttachSource: true, wantPlay: true });
    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.play(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('hiding');
    fireEvent.pause(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('visible');

    fireEvent.play(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('hiding');
    fireEvent.error(video);
    expect(chromeControls().getAttribute('data-chrome')).toBe('visible');
    expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy();
  });

  it('keeps the dominant feed clip attached after playback state updates', async () => {
    type MockObserver = IntersectionObserver & {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
    };
    const observers: MockObserver[] = [];
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      callback: IntersectionObserverCallback;
      targets = new Set<Element>();
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this as MockObserver);
      }
      observe = (el: Element) => {
        this.targets.add(el);
      };
      unobserve = (el: Element) => {
        this.targets.delete(el);
      };
      disconnect = () => {
        this.targets.clear();
      };
      takeRecords = () => [];
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    try {
      render(
        <CommunityVideoPlaybackProvider
          overlayOpen={false}
          selectedPostId={null}
          composerOpen={false}
          gallery={null}
        >
          <CommunityVideoPlayer postId="p1" surface="feed" src={`${src}?a`} />
          <CommunityVideoPlayer postId="p2" surface="feed" src={`${src}?b`} />
        </CommunityVideoPlaybackProvider>,
      );

      expect(observers.length).toBeGreaterThan(0);
      const observer = observers[0];
      const roots = [...observer.targets] as HTMLElement[];
      const first = roots.find((el) => el.getAttribute('data-post-id') === 'p1');
      const second = roots.find((el) => el.getAttribute('data-post-id') === 'p2');
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();

      act(() => {
        observer.callback(
          [
            {
              target: first as Element,
              intersectionRatio: 1,
              isIntersecting: true,
            } as IntersectionObserverEntry,
            {
              target: second as Element,
              intersectionRatio: 1,
              isIntersecting: true,
            } as IntersectionObserverEntry,
          ],
          observer,
        );
      });

      await waitFor(() => {
        expect(first?.getAttribute('data-attached')).toBe('true');
        expect(first?.getAttribute('data-want-play')).toBe('true');
      });
      expect(second?.getAttribute('data-attached')).toBe('false');
      expect(second?.getAttribute('data-want-play')).toBe('false');
      expect((first?.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(
        `${src}?a`,
      );
      expect((second?.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBeNull();

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(first?.getAttribute('data-attached')).toBe('true');
      expect(first?.getAttribute('data-want-play')).toBe('true');
      expect(second?.getAttribute('data-attached')).toBe('false');
      expect(observers).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not treat src detach as unplayable and resumes when reattached', async () => {
    const { rerender } = render(
      <CommunityVideoPlayer postId="p1" surface="gallery" src={src} canAttachSource wantPlay />,
    );
    expect((document.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(src);

    rerender(<CommunityVideoPlayer postId="p1" surface="gallery" src={src} wantPlay />);
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);
    expect(screen.queryByRole('status')).toBeNull();

    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    rerender(
      <CommunityVideoPlayer postId="p1" surface="gallery" src={src} canAttachSource wantPlay />,
    );
    expect((document.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(src);
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });
});
