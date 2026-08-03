// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileAvatar from './ProfileAvatar';

const resolveAvatar = vi.fn(async () => ({ url: '', repaired: false }));

vi.mock('../../lib/avatarClient', () => ({
  resolveAvatar: (...args: unknown[]) => resolveAvatar(...args),
}));

describe('ProfileAvatar', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders live avatarFile.url and ignores stale avatarUrl', () => {
    render(
      <ProfileAvatar
        profile={{
          displayName: 'Live User',
          email: 'live@example.com',
          avatarFile: { id: 'f1', url: 'https://live.example/ok.png' },
          avatarUrl: 'https://stale.example/expired.png',
        }}
      />,
    );

    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://live.example/ok.png');
    expect(resolveAvatar).not.toHaveBeenCalled();
  });

  it('does not render stale avatarUrl alone', () => {
    render(
      <ProfileAvatar
        profile={{
          displayName: 'Stale Only',
          email: 'stale@example.com',
          avatarUrl: 'https://stale.example/expired.png',
        }}
      />,
    );

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('SO')).toBeTruthy();
  });

  it('falls back to initials when the image errors and resolve fails', async () => {
    resolveAvatar.mockResolvedValueOnce({ url: '', repaired: false });
    render(
      <ProfileAvatar
        profile={{
          userId: 'u1',
          displayName: 'Broken Img',
          email: 'broken@example.com',
          avatarFile: { id: 'f1', url: 'https://cdn/broken.png' },
          avatarPath: 'profile-avatars/u1/avatar.png',
        }}
      />,
    );

    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);

    await waitFor(() => {
      expect(screen.getByText('BI')).toBeTruthy();
    });
    expect(document.querySelector('img')).toBeNull();
  });
});
