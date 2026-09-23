import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../db';
import {
  COMMUNITY_NEW_ACTIVITY_LIMIT,
  buildOrderedActivityThreads,
  canUseCommunityLastSeenStorage,
  collectActivityThreadMaxByPostId,
  filterRowsInSnapshotWindow,
  formatActivityChipCount,
  getLastSeenAt,
  isActivityQueryCapped,
  readLastSeenByUser,
  shouldEstablishBaseline,
  withLastSeenAt,
  writeLastSeenByUser,
  type LastSeenByUserMap,
} from '../../lib/communityNewActivity';
import { nowIso } from '../../lib/utils';
import type { CommunityComment, CommunityPost } from '../../types';

export type CommunityFeedView = 'default' | 'new';

type SnapshotWindow = {
  previousCursor: string;
  snapshotAt: string;
};

/**
 * New Activity: per-user localStorage cursor + bounded Instant queries.
 * Isolated from Famous / createdAt feed. Never uses lastActivityAt.
 */
export function useCommunityNewActivity(options: {
  currentUserId: string;
  feedView: CommunityFeedView;
  /** True after default Community list has successfully loaded (!listLoading && !listError). */
  listReady: boolean;
}) {
  const { currentUserId, feedView, listReady } = options;

  const [storageOk] = useState(() => canUseCommunityLastSeenStorage());
  const [lastSeenMap, setLastSeenMap] = useState<LastSeenByUserMap>(() =>
    storageOk ? readLastSeenByUser() : {},
  );
  const [snapshot, setSnapshot] = useState<SnapshotWindow | null>(null);
  const committedSnapshotAtRef = useRef<string | null>(null);

  const lastSeenAt = storageOk ? getLastSeenAt(lastSeenMap, currentUserId) : null;
  const enabled = Boolean(storageOk && currentUserId);

  // First visit baseline after successful default load only.
  useEffect(() => {
    if (
      !shouldEstablishBaseline({
        userId: currentUserId,
        lastSeenAt,
        listReady,
        storageOk,
      })
    ) {
      return;
    }
    const stamp = nowIso();
    setLastSeenMap((prev) => {
      if (getLastSeenAt(prev, currentUserId)) return prev;
      const next = withLastSeenAt(prev, currentUserId, stamp);
      if (!writeLastSeenByUser(next)) return prev;
      return next;
    });
  }, [currentUserId, lastSeenAt, listReady, storageOk]);

  const liveEnabled = enabled && feedView === 'default' && Boolean(lastSeenAt);
  const snapshotEnabled = enabled && feedView === 'new' && Boolean(snapshot);

  const liveQuery = useMemo(() => {
    if (!liveEnabled || !lastSeenAt) return null;
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
  }, [liveEnabled, lastSeenAt]);

  // Prefer $gt + $lte when Instant accepts the combo; also client-filter as safety net.
  const snapshotQuery = useMemo(() => {
    if (!snapshotEnabled || !snapshot) return null;
    const { previousCursor, snapshotAt } = snapshot;
    return {
      communityPosts: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gt: previousCursor, $lte: snapshotAt },
          },
          order: { createdAt: 'desc' as const },
          limit: COMMUNITY_NEW_ACTIVITY_LIMIT,
        },
      },
      communityComments: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gt: previousCursor, $lte: snapshotAt },
          },
          order: { createdAt: 'desc' as const },
          limit: COMMUNITY_NEW_ACTIVITY_LIMIT,
        },
      },
    };
  }, [snapshotEnabled, snapshot]);

  const { data: liveData, error: liveError } = db.useQuery(liveQuery);
  const {
    data: snapshotData,
    isLoading: snapshotLoading,
    error: snapshotError,
  } = db.useQuery(snapshotQuery);

  const activityPostsRaw = useMemo(() => {
    if (feedView === 'new') {
      const rows = (snapshotData?.communityPosts ?? []) as CommunityPost[];
      if (!snapshot) return [];
      return filterRowsInSnapshotWindow(rows, snapshot.previousCursor, snapshot.snapshotAt);
    }
    return (liveData?.communityPosts ?? []) as CommunityPost[];
  }, [feedView, liveData?.communityPosts, snapshot, snapshotData?.communityPosts]);

  const activityCommentsRaw = useMemo(() => {
    if (feedView === 'new') {
      const rows = (snapshotData?.communityComments ?? []) as CommunityComment[];
      if (!snapshot) return [];
      return filterRowsInSnapshotWindow(rows, snapshot.previousCursor, snapshot.snapshotAt);
    }
    return (liveData?.communityComments ?? []) as CommunityComment[];
  }, [feedView, liveData?.communityComments, snapshot, snapshotData?.communityComments]);

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
    // Resolve parents for active check (chip) and full cards (New view).
    return {
      communityPosts: {
        $: {
          where: { id: { $in: parentIds } },
        },
        author: { avatarFile: {} },
        attachmentFile: {},
      },
    };
  }, [parentIds, parentIdsKey]);

  const {
    data: parentData,
    isLoading: parentsLoading,
    error: parentsError,
  } = db.useQuery(parentQuery);

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

  const rawPostsLen = activityPostsRaw.length;
  const rawCommentsLen = activityCommentsRaw.length;
  const capped = isActivityQueryCapped(rawPostsLen, rawCommentsLen);
  const count = orderedThreads.length;
  const chipCountLabel = formatActivityChipCount(count, capped);
  const showChip = enabled && feedView === 'default' && Boolean(lastSeenAt) && count > 0 && !liveError;

  const newPostsById = useMemo(() => {
    const map = new Map<string, CommunityPost>();
    for (const p of parentPosts) {
      if (p.status === 'active') map.set(p.id, p);
    }
    return map;
  }, [parentPosts]);

  const newPosts = useMemo(() => {
    if (feedView !== 'new') return [] as CommunityPost[];
    const list: CommunityPost[] = [];
    for (const thread of orderedThreads) {
      const post = newPostsById.get(thread.postId);
      if (post) list.push(post);
    }
    return list;
  }, [feedView, orderedThreads, newPostsById]);

  const newViewLoading =
    feedView === 'new' && (snapshotLoading || (Boolean(parentIds.length) && parentsLoading));
  const newViewError = Boolean(
    feedView === 'new' && (snapshotError || parentsError),
  );

  // Commit lastSeenAt = snapshotAt on successful New resolve only.
  useEffect(() => {
    if (feedView !== 'new' || !snapshot || !currentUserId || !storageOk) return;
    if (snapshotLoading || (parentIds.length > 0 && parentsLoading)) return;
    if (snapshotError || parentsError) return;
    if (committedSnapshotAtRef.current === snapshot.snapshotAt) return;

    committedSnapshotAtRef.current = snapshot.snapshotAt;
    const stamp = snapshot.snapshotAt;
    setLastSeenMap((prev) => {
      const next = withLastSeenAt(prev, currentUserId, stamp);
      if (!writeLastSeenByUser(next)) return prev;
      return next;
    });
  }, [
    feedView,
    snapshot,
    currentUserId,
    storageOk,
    snapshotLoading,
    parentsLoading,
    parentIds.length,
    snapshotError,
    parentsError,
  ]);

  const openNew = useCallback((): boolean => {
    if (!enabled || !lastSeenAt) return false;
    committedSnapshotAtRef.current = null;
    setSnapshot({
      previousCursor: lastSeenAt,
      snapshotAt: nowIso(),
    });
    return true;
  }, [enabled, lastSeenAt]);

  const clearSnapshot = useCallback(() => {
    setSnapshot(null);
    committedSnapshotAtRef.current = null;
  }, []);

  return {
    enabled,
    lastSeenAt,
    showChip,
    count,
    capped,
    chipCountLabel,
    openNew,
    clearSnapshot,
    newPosts,
    newViewLoading,
    newViewError,
    orderedThreadIds: orderedThreads.map((t) => t.postId),
  };
}
