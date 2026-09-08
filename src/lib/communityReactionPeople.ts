import type { AvatarProfileFields } from './avatarDisplay';
import type { CommunityReaction } from '../types';

export function uniqueReactionUserIds(rows: CommunityReaction[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = (row.userId || '').trim();
    if (id) seen.add(id);
  }
  return [...seen].sort();
}

export function reactionPersonLabel(
  profile: AvatarProfileFields | undefined,
  fallback: string,
): string {
  const name = profile?.displayName?.trim() || profile?.email?.trim();
  return name || fallback;
}

export function indexProfilesByUserId(
  profiles: Array<AvatarProfileFields & { userId?: string }>,
): Map<string, AvatarProfileFields> {
  const map = new Map<string, AvatarProfileFields>();
  for (const profile of profiles) {
    const id = profile.userId?.trim();
    if (!id || map.has(id)) continue;
    map.set(id, profile);
  }
  return map;
}

export function reactionWhoNames(
  userIds: string[],
  profilesByUserId: ReadonlyMap<string, AvatarProfileFields>,
  unknownLabel: string,
): string {
  return userIds.map((id) => reactionPersonLabel(profilesByUserId.get(id), unknownLabel)).join(', ');
}
