// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { CommunityVideoPlaybackProvider } from './CommunityVideoPlayback';
import { CommunityVideoPlayer } from './CommunityVideoPlayer';

/** Device checks still required: iOS Safari / Android Chrome unmuted autoplay, Low Power Mode, iOS inline+mute fallback, unmute after muted autoplay. */

afterEach(() => {
  cleanup();
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
    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 12, clientY: 11 });
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
});
