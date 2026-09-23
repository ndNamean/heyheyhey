/**
 * Pure helpers for Community New Activity (cursor, dedupe, snapshot, cap).
 * Never uses communityPosts.lastActivityAt.
 */

export const COMMUNITY_NEW_ACTIVITY_LIMIT = 120;
export const COMMUNITY_LAST_SEEN_KEY = 'community.lastSeenByUser';

export type LastSeenByUserMap = Record<string, string>;

export type ActivityPostRow = {
  id: string;
  authorUserId: string;
  createdAt: string;
  status?: string;
};

export type ActivityCommentRow = {
  id: string;
  postId: string;
  authorUserId: string;
  createdAt: string;
  status?: string;
};

export type ActivityParentRow = {
  id: string;
  status: string;
};

export type ActivityThread = {
  postId: string;
  maxCreatedAt: string;
};

/** Probe localStorage; false in private mode / blocked storage. */
export function canUseCommunityLastSeenStorage(): boolean {
  try {
    const probe = '__community_last_seen_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readLastSeenByUser(): LastSeenByUserMap {
  try {
    const raw = localStorage.getItem(COMMUNITY_LAST_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LastSeenByUserMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Returns false when write fails (quota / private mode). */
export function writeLastSeenByUser(map: LastSeenByUserMap): boolean {
  try {
    localStorage.setItem(COMMUNITY_LAST_SEEN_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function getLastSeenAt(map: LastSeenByUserMap, userId: string): string | null {
  if (!userId) return null;
  const v = map[userId];
  return typeof v === 'string' && v ? v : null;
}

export function withLastSeenAt(
  map: LastSeenByUserMap,
  userId: string,
  iso: string,
): LastSeenByUserMap {
  if (!userId || !iso) return map;
  return { ...map, [userId]: iso };
}

/**
 * First visit: establish baseline only after default list loaded successfully
 * and no cursor exists yet. Do not count history before that.
 */
export function shouldEstablishBaseline(options: {
  userId: string;
  lastSeenAt: string | null;
  listReady: boolean;
  storageOk: boolean;
}): boolean {
  const { userId, lastSeenAt, listReady, storageOk } = options;
  if (!storageOk || !userId || !listReady) return false;
  return !lastSeenAt;
}

/** Keep rows strictly after cursor and at or before snapshotAt (ISO string compare). */
export function rowInSnapshotWindow(
  createdAt: string,
  previousCursor: string,
  snapshotAt: string,
): boolean {
  if (!createdAt) return false;
  return createdAt > previousCursor && createdAt <= snapshotAt;
}

export function filterRowsInSnapshotWindow<T extends { createdAt: string }>(
  rows: T[],
  previousCursor: string,
  snapshotAt: string,
): T[] {
  return rows.filter((r) => rowInSnapshotWindow(r.createdAt, previousCursor, snapshotAt));
}

/**
 * Seed map postId → max content createdAt from other-user posts/comments.
 * Own author activity is excluded client-side.
 */
export function collectActivityThreadMaxByPostId(options: {
  posts: ActivityPostRow[];
  comments: ActivityCommentRow[];
  currentUserId: string;
}): Map<string, string> {
  const { posts, comments, currentUserId } = options;
  const map = new Map<string, string>();

  const bump = (postId: string, ts: string) => {
    if (!postId || !ts) return;
    const prev = map.get(postId);
    if (!prev || ts > prev) map.set(postId, ts);
  };

  for (const post of posts) {
    if (!post?.id) continue;
    if (currentUserId && post.authorUserId === currentUserId) continue;
    bump(post.id, post.createdAt);
  }

  for (const comment of comments) {
    if (!comment?.postId) continue;
    if (currentUserId && comment.authorUserId === currentUserId) continue;
    bump(comment.postId, comment.createdAt);
  }

  return map;
}

/**
 * Drop missing / non-active parents; order by max content ts desc, then postId.
 */
export function resolveActivityThreads(
  threadMaxByPostId: Map<string, string>,
  parents: ActivityParentRow[],
): ActivityThread[] {
  const parentById = new Map<string, ActivityParentRow>();
  for (const p of parents) {
    if (p?.id) parentById.set(p.id, p);
  }

  const threads: ActivityThread[] = [];
  for (const [postId, maxCreatedAt] of threadMaxByPostId) {
    const parent = parentById.get(postId);
    if (!parent || parent.status !== 'active') continue;
    threads.push({ postId, maxCreatedAt });
  }

  threads.sort((a, b) => {
    if (a.maxCreatedAt !== b.maxCreatedAt) {
      return a.maxCreatedAt < b.maxCreatedAt ? 1 : -1;
    }
    return a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0;
  });

  return threads;
}

/** True when either bounded query returned a full page (limit hit). */
export function isActivityQueryCapped(
  postsLength: number,
  commentsLength: number,
  limit: number = COMMUNITY_NEW_ACTIVITY_LIMIT,
): boolean {
  return postsLength >= limit || commentsLength >= limit;
}

/** Chip count fragment: `5` or `5+`. */
export function formatActivityChipCount(count: number, capped: boolean): string {
  const n = Math.max(0, count);
  return capped ? `${n}+` : `${n}`;
}

/**
 * Build ordered unique threads from activity rows + resolved parents.
 * Pure pipeline used by both chip count and New view.
 */
export function buildOrderedActivityThreads(options: {
  posts: ActivityPostRow[];
  comments: ActivityCommentRow[];
  parents: ActivityParentRow[];
  currentUserId: string;
}): ActivityThread[] {
  const threadMax = collectActivityThreadMaxByPostId({
    posts: options.posts,
    comments: options.comments,
    currentUserId: options.currentUserId,
  });
  return resolveActivityThreads(threadMax, options.parents);
}
