/**
 * Resolve Instant profiles.id for a Logbook actor.
 * loadProfileContext returns `profileId` (not `id`).
 * Falls back to matching profiles[] by userId when profileId is missing.
 */
export function resolveActorProfileId(actor, profiles = []) {
  const fromActor =
    typeof actor?.profileId === 'string' ? actor.profileId.trim() : '';
  if (fromActor) return fromActor;

  const userId = typeof actor?.userId === 'string' ? actor.userId.trim() : '';
  if (!userId) return '';

  const match = (Array.isArray(profiles) ? profiles : []).find(
    (p) => p && typeof p.userId === 'string' && p.userId === userId && p.id,
  );
  return match?.id ? String(match.id) : '';
}
