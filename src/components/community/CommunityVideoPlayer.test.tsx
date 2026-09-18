// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommunityVideoPlayer } from './CommunityVideoPlayer';

afterEach(() => cleanup());

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

describe('CommunityVideoPlayer', () => {
  it('uses stored aspect ratio, contain class, and no native loop', () => {
    render(
      <CommunityVideoPlayer
        postId="p1"
        surface="feed"
        src="https://example.com/clip.mp4"
        width={1080}
        height={1920}
        canAttachSource
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.className).toContain('community-card-video-el');
    expect(document.querySelector('.community-card-image')).toBeNull();
    const frame = document.querySelector('.community-card-video-frame') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('1080 / 1920');
  });

  it('falls back to 16/9 and attaches src only when allowed', () => {
    const { rerender } = render(
      <CommunityVideoPlayer postId="p1" surface="feed" src="https://example.com/clip.mp4" />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBeNull();
    expect(document.querySelector('.community-card-video-frame') as HTMLElement).toHaveProperty(
      'style.aspectRatio',
      '16 / 9',
    );

    rerender(
      <CommunityVideoPlayer
        postId="p1"
        surface="feed"
        src="https://example.com/clip.mp4"
        canAttachSource
      />,
    );
    expect((document.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(
      'https://example.com/clip.mp4',
    );
  });

  it('shows Replay after ended and does not auto-loop', () => {
    render(
      <CommunityVideoPlayer
        postId="p1"
        surface="feed"
        src="https://example.com/clip.mp4"
        canAttachSource
        wantPlay
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.ended(video);
    expect(screen.getByRole('button', { name: /replay/i })).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('calls play() from the Play button even when autoplay is off', () => {
    render(
      <CommunityVideoPlayer
        postId="p1"
        surface="feed"
        src="https://example.com/clip.mp4"
        canAttachSource
      />,
    );
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('stops control gestures from bubbling', () => {
    const onBubble = vi.fn();
    render(
      <div onPointerDown={onBubble}>
        <CommunityVideoPlayer
          postId="p1"
          surface="feed"
          src="https://example.com/clip.mp4"
          canAttachSource
        />
      </div>,
    );
    fireEvent.pointerDown(document.querySelector('.community-video-controls') as HTMLElement);
    expect(onBubble).not.toHaveBeenCalled();
  });
});
