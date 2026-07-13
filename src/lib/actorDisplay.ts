import type { Profile } from '../types';

export function resolveActorDisplay(
  userId: string,
  snapshot: string | undefined,
  profiles: Profile[],
): string {
  if (snapshot?.trim()) return snapshot.trim();
  const p = profiles.find((x) => x.userId === userId);
  if (p?.displayName?.trim()) return p.displayName.trim();
  if (p?.email) return p.email.split('@')[0] ?? p.email;
  if (userId) return `Former user — ${userId.slice(0, 8)}`;
  return 'Unknown';
}
