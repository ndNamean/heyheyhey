/**
 * Community Builders — pure contribution scoring for the current calendar month.
 *
 * Business month uses Asia/Ho_Chi_Minh (UTC+7, no DST), matching the repo's
 * default schedule timezone. Near-midnight UTC rows can fall into the prior or
 * next HCM calendar day by a few hours; that boundary is intentional.
 */

export const COMMUNITY_BUILDERS_TIMEZONE = 'Asia/Ho_Chi_Minh';
/** Fixed offset for Asia/Ho_Chi_Minh (no DST). */
export const COMMUNITY_BUILDERS_TZ_OFFSET = '+07:00';

export const COMMUNITY_BUILDER_POST_WEIGHT = 3;
export const COMMUNITY_BUILDER_COMMENT_WEIGHT = 2;
export const COMMUNITY_BUILDER_SUPPORT_WEIGHT = 1;
export const COMMUNITY_BUILDERS_LIMIT = 5;

export type BuilderPostRow = {
  id: string;
  authorUserId: string;
  createdAt: string;
  status: string;
};

export type BuilderCommentRow = {
  id: string;
  authorUserId: string;
  createdAt: string;
  status: string;
};

export type BuilderReactionRow = {
  userId: string;
  postId: string;
  commentId: string;
  createdAt: string;
};

export type BuilderCandidate = {
  userId: string;
  score: number;
  /** How many of {Share, Connect, Support} are > 0. */
  categoryCount: number;
  lastContributionAt: string;
  postCount: number;
  commentCount: number;
  supportCount: number;
};

/** Raw action sum for UI tooltips — not the weighted ranking score. */
export function builderContributionCount(
  c: Pick<BuilderCandidate, 'postCount' | 'commentCount' | 'supportCount'>,
): number {
  return (c.postCount || 0) + (c.commentCount || 0) + (c.supportCount || 0);
}

function isActiveStatus(status: string | undefined): boolean {
  return (status || '').trim() === 'active';
}

function inMonthWindow(createdAt: string, monthStartIso: string, nowMs: number): boolean {
  const created = Date.parse(createdAt);
  const start = Date.parse(monthStartIso);
  if (!Number.isFinite(created) || !Number.isFinite(start)) return false;
  return created >= start && created <= nowMs;
}

/**
 * First instant of the current calendar month in Asia/Ho_Chi_Minh, as an ISO
 * string with +07:00 offset (e.g. 2026-09-01T00:00:00+07:00).
 */
export function communityBuildersMonthStartIso(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COMMUNITY_BUILDERS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!year || !month) {
    const d = new Date(nowMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01T00:00:00${COMMUNITY_BUILDERS_TZ_OFFSET}`;
  }
  return `${year}-${month}-01T00:00:00${COMMUNITY_BUILDERS_TZ_OFFSET}`;
}

/** Support dedupe: one credit per (user, post) or (user, comment) target. */
export function supportDedupeKey(
  row: Pick<BuilderReactionRow, 'userId' | 'postId' | 'commentId'>,
): string {
  return `${row.userId}:${row.postId}:${(row.commentId || '').trim()}`;
}

function bumpLast(prev: string, next: string): string {
  if (!prev) return next || '';
  if (!next) return prev;
  return next.localeCompare(prev) > 0 ? next : prev;
}

/**
 * Aggregate and rank builders for the month window.
 * Does not apply profile eligibility — callers walk the list and skip ineligible IDs.
 */
export function rankCommunityBuilders(
  posts: BuilderPostRow[],
  comments: BuilderCommentRow[],
  reactions: BuilderReactionRow[],
  options?: {
    monthStartIso?: string;
    nowMs?: number;
  },
): BuilderCandidate[] {
  const nowMs = options?.nowMs ?? Date.now();
  const monthStartIso = options?.monthStartIso ?? communityBuildersMonthStartIso(nowMs);

  type Acc = {
    postCount: number;
    commentCount: number;
    supportKeys: Set<string>;
    lastContributionAt: string;
  };

  const byUser = new Map<string, Acc>();

  const ensure = (userId: string): Acc | null => {
    const id = (userId || '').trim();
    if (!id) return null;
    let acc = byUser.get(id);
    if (!acc) {
      acc = { postCount: 0, commentCount: 0, supportKeys: new Set(), lastContributionAt: '' };
      byUser.set(id, acc);
    }
    return acc;
  };

  for (const post of posts) {
    if (!isActiveStatus(post.status)) continue;
    if (!inMonthWindow(post.createdAt, monthStartIso, nowMs)) continue;
    const acc = ensure(post.authorUserId);
    if (!acc) continue;
    acc.postCount += 1;
    acc.lastContributionAt = bumpLast(acc.lastContributionAt, post.createdAt);
  }

  for (const comment of comments) {
    if (!isActiveStatus(comment.status)) continue;
    if (!inMonthWindow(comment.createdAt, monthStartIso, nowMs)) continue;
    const acc = ensure(comment.authorUserId);
    if (!acc) continue;
    acc.commentCount += 1;
    acc.lastContributionAt = bumpLast(acc.lastContributionAt, comment.createdAt);
  }

  for (const reaction of reactions) {
    if (!inMonthWindow(reaction.createdAt, monthStartIso, nowMs)) continue;
    const acc = ensure(reaction.userId);
    if (!acc) continue;
    const key = supportDedupeKey(reaction);
    if (!acc.supportKeys.has(key)) {
      acc.supportKeys.add(key);
      acc.lastContributionAt = bumpLast(acc.lastContributionAt, reaction.createdAt);
    }
  }

  const candidates: BuilderCandidate[] = [];
  for (const [userId, acc] of byUser) {
    const supportCount = acc.supportKeys.size;
    const score =
      acc.postCount * COMMUNITY_BUILDER_POST_WEIGHT +
      acc.commentCount * COMMUNITY_BUILDER_COMMENT_WEIGHT +
      supportCount * COMMUNITY_BUILDER_SUPPORT_WEIGHT;
    if (score <= 0) continue;
    let categoryCount = 0;
    if (acc.postCount > 0) categoryCount += 1;
    if (acc.commentCount > 0) categoryCount += 1;
    if (supportCount > 0) categoryCount += 1;
    candidates.push({
      userId,
      score,
      categoryCount,
      lastContributionAt: acc.lastContributionAt,
      postCount: acc.postCount,
      commentCount: acc.commentCount,
      supportCount,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.categoryCount !== a.categoryCount) return b.categoryCount - a.categoryCount;
    const last = (b.lastContributionAt || '').localeCompare(a.lastContributionAt || '');
    if (last) return last;
    return (a.userId || '').localeCompare(b.userId || '');
  });

  return candidates;
}

/**
 * Select up to `limit` displayable builder user IDs.
 * Walks the ranked list; when `eligibleUserIds` is provided, skips IDs not in the set
 * (approved / resolvable profiles) and fills from the next ranked candidates.
 */
export function selectCommunityBuilders(
  posts: BuilderPostRow[],
  comments: BuilderCommentRow[],
  reactions: BuilderReactionRow[],
  options?: {
    monthStartIso?: string;
    nowMs?: number;
    eligibleUserIds?: ReadonlySet<string>;
    limit?: number;
  },
): string[] {
  const limit = options?.limit ?? COMMUNITY_BUILDERS_LIMIT;
  const ranked = rankCommunityBuilders(posts, comments, reactions, {
    monthStartIso: options?.monthStartIso,
    nowMs: options?.nowMs,
  });
  const eligible = options?.eligibleUserIds;
  const out: string[] = [];
  for (const row of ranked) {
    if (out.length >= limit) break;
    if (eligible && !eligible.has(row.userId)) continue;
    out.push(row.userId);
  }
  return out;
}
