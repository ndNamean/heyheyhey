export type UniqueCountAction = 'add' | 'remove';

export function applyCounterDelta(current: number, delta: number): number {
  const n = Number(current);
  const base = Number.isFinite(n) ? n : 0;
  return Math.max(0, base + delta);
}

/**
 * Unique participant count changes only on 0→1 (add) and 1→0 (remove).
 * `existingForPost` is the current set for that post (reactions, or active comments).
 */
export function uniqueParticipantDelta(
  existingForPost: Array<{ userId: string }>,
  userId: string,
  action: UniqueCountAction,
): number {
  const uid = userId.trim();
  if (!uid) return 0;
  let count = 0;
  for (const row of existingForPost) {
    if ((row.userId || '').trim() === uid) count += 1;
  }
  if (action === 'add') return count === 0 ? 1 : 0;
  return count === 1 ? -1 : 0;
}

export function uniqueReactorDelta(
  existingForPost: Array<{ userId: string }>,
  userId: string,
  action: UniqueCountAction,
): number {
  return uniqueParticipantDelta(existingForPost, userId, action);
}

export function uniqueCommenterDelta(
  existingActiveForPost: Array<{ userId: string }>,
  userId: string,
  action: UniqueCountAction,
): number {
  return uniqueParticipantDelta(existingActiveForPost, userId, action);
}
