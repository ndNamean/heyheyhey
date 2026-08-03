import { describe, expect, it } from 'vitest';
import {
  profileHasAvatar,
  profileWithoutAvatarDisplay,
  resolveAvatarUrl,
} from './avatarDisplay';

describe('avatarDisplay', () => {
  it('prefers live avatarFile.url and ignores stale avatarUrl', () => {
    expect(
      resolveAvatarUrl({
        avatarFile: { id: 'f1', url: 'https://live.example/a.png' },
        avatarUrl: 'https://stale.example/old.png',
      }),
    ).toBe('https://live.example/a.png');

    expect(
      resolveAvatarUrl({
        avatarUrl: 'https://stale.example/old.png',
      }),
    ).toBe('');

    expect(resolveAvatarUrl({ avatarFile: { id: 'f1', url: '  ' } })).toBe('');
    expect(resolveAvatarUrl(null)).toBe('');
  });

  it('detects has-avatar from link, path, or legacy url', () => {
    expect(profileHasAvatar({ avatarFile: { id: 'f1', url: 'https://x' } })).toBe(true);
    expect(profileHasAvatar({ avatarFile: { id: 'f1' } })).toBe(true);
    expect(profileHasAvatar({ avatarPath: 'profile-avatars/u/avatar.png' })).toBe(true);
    expect(profileHasAvatar({ avatarUrl: 'https://stale' })).toBe(true);
    expect(profileHasAvatar({ avatarUrl: '', avatarPath: '' })).toBe(false);
    expect(profileHasAvatar(null)).toBe(false);
  });

  it('strips display fields for initials fallback', () => {
    expect(
      profileWithoutAvatarDisplay({
        displayName: 'A',
        email: 'a@b.c',
        avatarFile: { id: 'f1', url: 'https://x' },
        avatarPath: 'p',
        avatarUrl: 'https://stale',
      }),
    ).toEqual({
      displayName: 'A',
      email: 'a@b.c',
      avatarFile: undefined,
      avatarPath: '',
      avatarUrl: '',
    });
  });
});
