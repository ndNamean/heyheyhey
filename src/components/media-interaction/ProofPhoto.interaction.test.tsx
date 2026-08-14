// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProofPhoto from '../ProofPhoto';

vi.mock('../../i18n', () => ({
  useLang: () => ({
    lang: 'en',
    t: {
      photoSheet: {
        title: 'Photo Sheet',
        loading: 'Loading photo…',
        photoMissing: 'Photo unavailable',
        videoPlaybackFailed: 'Video could not play in the browser.',
        openVideoInNewTab: 'Open video in new tab',
        openOriginal: 'Open original',
        zoomImage: 'Zoom image: {alt}',
        photoRemoved: 'Photo removed',
      },
    },
  }),
}));

vi.mock('../ProofReviewOverlay', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { className: 'proof-overlay-root' }, 'overlay'),
  };
});

function installMatchMedia(opts: { fineHover?: boolean; reducedMotion?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion')
        ? Boolean(opts.reducedMotion)
        : query.includes('pointer: fine')
          ? Boolean(opts.fineHover)
          : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ProofPhoto interaction wiring', () => {
  beforeEach(() => {
    installMatchMedia({ fineHover: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('still photos: sibling Open original, no wrapping <a>, zoom wraps img + overlay', () => {
    render(
      <ProofPhoto
        media={{
          id: 'm1',
          url: 'https://cdn.example/photo.jpg',
          fileName: 'front.jpg',
          lat: 10,
          lng: 20,
          capturedAt: '2026-01-01T00:00:00.000Z',
          proofMetadataJson: JSON.stringify({ proofTimestamp: '2026-01-01T00:00:00.000Z' }),
        }}
      />,
    );

    const wrappingLink = document.querySelector('a.proof-photo-link');
    expect(wrappingLink).toBeNull();
    expect(document.querySelector('div.proof-photo-link')).toBeTruthy();

    const open = screen.getByRole('link', { name: 'Open original' });
    expect(open.getAttribute('href')).toBe('https://cdn.example/photo.jpg');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noreferrer');
    expect(open.className).toContain('proof-photo-open-original');

    const zoom = screen.getByRole('button', { name: 'Zoom image: front.jpg' });
    const img = zoom.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/photo.jpg');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(zoom.querySelector('.proof-overlay-root')).toBeTruthy();

    expect(open.closest('.media-zoom')).toBeNull();
  });

  it('leaves removed placeholder unchanged and does not fetch when url is present', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://should-not-use' }),
    } as Response);

    render(
      <ProofPhoto media={{ id: 'gone', storageDeleted: true, photoCode: 'PC-1' } as any} />,
    );
    expect(screen.getByText('Photo removed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull();

    cleanup();
    render(
      <ProofPhoto media={{ id: 'ok', url: 'https://cdn.example/ok.jpg', fileName: 'ok.jpg' }} />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open original' })).toBeTruthy();
  });

  it('zoom tap does not navigate; Open original keeps the raw href', () => {
    render(
      <ProofPhoto media={{ id: 'm2', url: 'https://cdn.example/raw.jpg', fileName: 'raw.jpg' }} />,
    );
    const zoom = screen.getByRole('button', { name: 'Zoom image: raw.jpg' });
    fireEvent.click(zoom);
    expect(screen.getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe(
      'https://cdn.example/raw.jpg',
    );
    expect(document.querySelector('a.proof-photo-link')).toBeNull();
  });

  it('zoom button inside a checkbox label does not toggle the checkbox', () => {
    const onChange = vi.fn();
    render(
      <label>
        <input type="checkbox" onChange={onChange} />
        <span>Issue title</span>
        <ProofPhoto media={{ id: 'm3', url: 'https://cdn.example/a.jpg', fileName: 'a.jpg' }} />
      </label>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoom image: a.jpg' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Issue title'));
    expect(onChange).toHaveBeenCalled();
  });

  it('videos: FloatableVideo wraps player, open-video link stays outside, native controls kept', () => {
    render(
      <ProofPhoto
        media={{
          id: 'v1',
          url: 'https://cdn.example/clip.mp4',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
        }}
      />,
    );

    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('playsInline')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.getAttribute('src')).toBe('https://cdn.example/clip.mp4');

    const float = document.querySelector('.media-float');
    expect(float).toBeTruthy();
    expect(float?.contains(video)).toBe(true);
    expect(float?.getAttribute('data-float-enabled')).toBe('true');

    const open = screen.getByRole('link', { name: 'Open video in new tab' });
    expect(open.getAttribute('href')).toBe('https://cdn.example/clip.mp4');
    expect(open.closest('.media-float')).toBeNull();
    expect(open.className).toContain('proof-video-open-link');

    fireEvent.click(video);
    expect(float?.getAttribute('data-float-state')).toBe('resting');
  });

  it('Photo Sheet can disable video float while keeping the open-video link', () => {
    render(
      <ProofPhoto
        enableVideoFloat={false}
        className="proof-photo-sheet-thumb"
        media={{
          id: 'v2',
          url: 'https://cdn.example/thumb.mp4',
          fileName: 'thumb.mp4',
          mimeType: 'video/mp4',
        }}
      />,
    );
    const float = document.querySelector('.media-float');
    expect(float?.getAttribute('data-float-enabled')).toBe('false');
    fireEvent.pointerEnter(float as HTMLElement);
    expect(float?.getAttribute('data-float-state')).toBe('resting');
    expect(screen.getByRole('link', { name: 'Open video in new tab' })).toBeTruthy();
  });
});
