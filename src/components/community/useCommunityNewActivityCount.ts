import { useMemo, useState, useSyncExternalStore } from 'react';
import { db } from '../../db';
import {
  COMMUNITY_LAST_SEEN_KEY,
  COMMUNITY_NEW_ACTIVITY_LIMIT,
  buildOrderedActivityThreads,
  canUseCommunityLastSeenStorage,
  collectActivityThreadMaxByPostId,
  formatActivityChipCount,
  getLastSeenAt,
  isActivityQueryCapped,
  readLastSeenByUser,
} from '../../lib/communityNewActivity';
import type { CommunityComment, CommunityPost } from '../../types';

/** Same-tab signal when Community last-seen cursor is written (baseline / New commit). */
export const COMMUNITY_LAST_SEEN_CHANGED_EVENT = 'community-last-seen-changed';

/** Notify count-hook subscribers after a successful last-seen write. */
export function notifyCommunityLastSeenChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COMMUNITY_LAST_SEEN_CHANGED_EVENT));
}

function subscribeLastSeenRaw(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(COMMUNITY_LAST_SEEN_CHANGED_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(COMMUNITY_LAST_SEEN_CHANGED_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

function getLastSeenRawSnapshot(): string | null {
  try {
    return localStorage.getItem(COMMUNITY_LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Live New Activity count only — for Community tab badge and in-page chip.
 * Does not write baseline, open New, or commit snapshot.
 */
export function useCommunityNewActivityCount(currentUserId: string): {
  count: number;
  capped: boolean;
  badgeLabel: string;
  showBadge: boolean;
  enabled: boolean;
} {
  const [storageOk] = useState(() => canUseCommunityLastSeenStorage());
  const raw = useSyncExternalStore(
    subscribeLastSeenRaw,
    getLastSeenRawSnapshot,
    () => null,
  );

  const lastSeenAt = useMemo(() => {
    if (!storageOk || !currentUserId || raw == null) return null;
    return getLastSeenAt(readLastSeenByUser(), currentUserId);
  }, [storageOk, currentUserId, raw]);

  const enabled = Boolean(storageOk && currentUserId);
  const queryEnabled = enabled && Boolean(lastSeenAt);

  const liveQuery = useMemo(() => {
    if (!queryEnabled || !lastSeenAt) return null;
    return {
      communityPosts: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gt: lastSeenAt },
          },
          order: { createdAt: 'desc' as const },
          limit: COMMUNITY_NEW_ACTIVITY_LIMIT,
        },
      },
      communityComments: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gt: lastSeenAt },
          },
          order: { createdAt: 'desc' as const },
          limit: COMMUNITY_NEW_ACTIVITY_LIMIT,
        },
      },
    };
  }, [queryEnabled, lastSeenAt]);

  const { data: liveData, error: liveError } = db.useQuery(liveQuery);

  const activityPostsRaw = useMemo(
    () => (liveData?.communityPosts ?? []) as CommunityPost[],
    [liveData?.communityPosts],
  );

  const activityCommentsRaw = useMemo(
    () => (liveData?.communityComments ?? []) as CommunityComment[],
    [liveData?.communityComments],
  );

  const threadMaxByPostId = useMemo(
    () =>
      collectActivityThreadMaxByPostId({
        posts: activityPostsRaw,
        comments: activityCommentsRaw,
        currentUserId,
      }),
    [activityPostsRaw, activityCommentsRaw, currentUserId],
  );

  const parentIds = useMemo(() => [...threadMaxByPostId.keys()], [threadMaxByPostId]);
  const parentIdsKey = parentIds.slice().sort().join('|');

  const parentQuery = useMemo(() => {
    if (!parentIds.length) return null;
    return {
      communityPosts: {
        $: {
          where: { id: { $in: parentIds } },
        },
      },
    };
  }, [parentIds, parentIdsKey]);

  const { data: parentData } = db.useQuery(parentQuery);

  const parentPosts = useMemo(
    () => (parentData?.communityPosts ?? []) as CommunityPost[],
    [parentData?.communityPosts],
  );

  const orderedThreads = useMemo(
    () =>
      buildOrderedActivityThreads({
        posts: activityPostsRaw,
        comments: activityCommentsRaw,
        parents: parentPosts,
        currentUserId,
      }),
    [activityPostsRaw, activityCommentsRaw, parentPosts, currentUserId],
  );

  const capped = isActivityQueryCapped(activityPostsRaw.length, activityCommentsRaw.length);
  const count = orderedThreads.length;
  const badgeLabel = formatActivityChipCount(count, capped);
  const showBadge =
    enabled && Boolean(lastSeenAt) && count > 0 && !liveError;

  return { count, capped, badgeLabel, showBadge, enabled };
}
