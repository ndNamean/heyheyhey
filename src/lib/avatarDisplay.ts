/**
 * Resolve profile avatar display URL from live $files link.
 * Do not use denormalized avatarUrl for rendering (signed URLs expire).
 */

import type { Profile } from '../types';

export type AvatarProfileFields = Pick<Profile, 'displayName' | 'email'> &
  Partial<Pick<Profile, 'avatarUrl' | 'avatarPath' | 'avatarFile' | 'userId'>>;

/** Live URL from linked $files only — never the stale denormalized avatarUrl. */
export function resolveAvatarUrl(
  profile: Pick<Profile, 'avatarFile'> | Partial<Pick<Profile, 'avatarUrl'>> | null | undefined,
): string {
  const live = profile && 'avatarFile' in profile ? profile.avatarFile?.url?.trim() : '';
  if (live) return live;
  return '';
}

/** Whether the profile has (or likely has) a photo — for remove UI / preview enablement. */
export function profileHasAvatar(
  profile:
    | Partial<Pick<Profile, 'avatarFile' | 'avatarPath' | 'avatarUrl'>>
    | null
    | undefined,
): boolean {
  if (!profile) return false;
  if (profile.avatarFile?.url?.trim() || profile.avatarFile?.id) return true;
  if (profile.avatarPath?.trim()) return true;
  if (profile.avatarUrl?.trim()) return true;
  return false;
}

/** Profile strip used when forcing initials (failed load / disabled preview). */
export function profileWithoutAvatarDisplay<
  T extends Partial<Pick<Profile, 'avatarFile' | 'avatarPath' | 'avatarUrl'>>,
>(profile: T): T {
  return {
    ...profile,
    avatarFile: undefined,
    avatarPath: '',
    avatarUrl: '',
  };
}
