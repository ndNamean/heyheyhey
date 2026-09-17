// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CommunityCommentGiphy from './CommunityCommentGiphy';

describe('CommunityCommentGiphy', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the stored preview and GIPHY attribution', () => {
    render(
      <CommunityCommentGiphy
        comment={{
          giphyId: 'abc',
          giphyUrl: 'https://media.giphy.com/media/abc/200.gif',
          giphyPreviewUrl: 'https://media.giphy.com/media/abc/100.gif',
          giphyTitle: 'Party parrot',
        }}
        unavailableLabel="GIF unavailable"
      />,
    );
    const img = screen.getByRole('img', { name: 'Party parrot' }) as HTMLImageElement;
    expect(img.src).toContain('100.gif');
    expect(screen.getByRole('link', { name: 'Powered by GIPHY' })).toBeTruthy();
  });

  it('falls back to title plus attribution when the image fails', () => {
    render(
      <CommunityCommentGiphy
        comment={{
          giphyId: 'abc',
          giphyUrl: 'https://media.giphy.com/media/abc/200.gif',
          giphyPreviewUrl: 'https://media.giphy.com/media/abc/100.gif',
          giphyTitle: 'Broken GIF',
        }}
        unavailableLabel="GIF unavailable"
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Broken GIF' }));
    expect(screen.getByRole('img', { name: 'GIF unavailable' }).textContent).toContain('Broken GIF');
    expect(screen.getByRole('link', { name: 'Powered by GIPHY' })).toBeTruthy();
  });

  it('renders nothing for text-only comments', () => {
    const { container } = render(
      <CommunityCommentGiphy comment={{}} unavailableLabel="GIF unavailable" />,
    );
    expect(container.querySelector('.community-comment-giphy')).toBeNull();
  });
});
