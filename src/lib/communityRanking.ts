export const COMMUNITY_FAMOUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMUNITY_FAMOUS_CANDIDATE_LIMIT = 40;
/** Engagement gap below this keeps the stable (older) vote-leader. */
export const COMMUNITY_FAMOUS_ENGAGEMENT_HYSTERESIS = 3;

export type FamousCandidate = {
  id: string;
  status: string;
  createdAt: string;
  lastActivityAt: string;
  famousVoteCount: number;
  uniqueReactorCount: number;
  uniqueCommenterCount: number;
};

export function famousWindowCutoffIso(
  nowMs: number = Date.now(),
  windowMs: number = COMMUNITY_FAMOUS_WINDOW_MS,
): string {
  return new Date(nowMs - windowMs).toISOString();
}

export function engagementSupport(post: Pick<FamousCandidate, 'uniqueCommenterCount' | 'uniqueReactorCount'>): number {
  const commenters = Number(post.uniqueCommenterCount);
  const reactors = Number(post.uniqueReactorCount);
  const c = Number.isFinite(commenters) ? Math.max(0, commenters) : 0;
  const r = Number.isFinite(reactors) ? Math.max(0, reactors) : 0;
  return c * 2 + r;
}

export function isFamousEligible(
  post: Pick<FamousCandidate, 'status' | 'createdAt'>,
  nowMs: number = Date.now(),
  windowMs: number = COMMUNITY_FAMOUS_WINDOW_MS,
): boolean {
  if ((post.status || '').trim() !== 'active') return false;
  const created = Date.parse(post.createdAt);
  if (!Number.isFinite(created)) return false;
  return created >= nowMs - windowMs;
}

function voteCount(post: FamousCandidate): number {
  const n = Number(post.famousVoteCount);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function compareRecencyThenId(a: FamousCandidate, b: FamousCandidate): number {
  const activity = (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '');
  if (activity) return activity;
  const created = (b.createdAt || '').localeCompare(a.createdAt || '');
  if (created) return created;
  return (a.id || '').localeCompare(b.id || '');
}

function compareStableLeader(a: FamousCandidate, b: FamousCandidate): number {
  const created = (a.createdAt || '').localeCompare(b.createdAt || '');
  if (created) return created;
  return (a.id || '').localeCompare(b.id || '');
}

/**
 * Deterministic Famous pin picker. All clients agree; no singleton row.
 *
 * 1. Eligible = active + created within the window.
 * 2. Highest famousVoteCount wins immediately (no hysteresis).
 * 3. Vote ties use engagementSupport = uniqueCommenterCount * 2 + uniqueReactorCount.
 * 4. If the engagement gap between the top engagement rank and the next is < 3,
 *    keep the stable leader (createdAt asc, then id asc) among vote-leaders.
 * 5. If gap >= 3, the higher-engagement group wins; further ties: newer
 *    lastActivityAt, newer createdAt, then id.
 */
export function selectFamousPost(
  candidates: FamousCandidate[],
  nowMs: number = Date.now(),
  windowMs: number = COMMUNITY_FAMOUS_WINDOW_MS,
): FamousCandidate | null {
  const eligible = candidates.filter((post) => isFamousEligible(post, nowMs, windowMs));
  if (!eligible.length) return null;

  let maxVotes = -1;
  for (const post of eligible) {
    const votes = voteCount(post);
    if (votes > maxVotes) maxVotes = votes;
  }
  const voteLeaders = eligible.filter((post) => voteCount(post) === maxVotes);
  if (voteLeaders.length === 1) return voteLeaders[0];

  let maxEng = -1;
  const engById = new Map<string, number>();
  for (const post of voteLeaders) {
    const eng = engagementSupport(post);
    engById.set(post.id, eng);
    if (eng > maxEng) maxEng = eng;
  }

  let secondEng = maxEng;
  for (const post of voteLeaders) {
    const eng = engById.get(post.id) ?? 0;
    if (eng < maxEng) {
      if (secondEng === maxEng || eng > secondEng) secondEng = eng;
    }
  }

  const gap = maxEng - secondEng;
  if (gap < COMMUNITY_FAMOUS_ENGAGEMENT_HYSTERESIS) {
    const stable = voteLeaders.slice().sort(compareStableLeader);
    return stable[0] ?? null;
  }

  const topEngagement = voteLeaders.filter((post) => (engById.get(post.id) ?? 0) === maxEng);
  const ranked = topEngagement.slice().sort(compareRecencyThenId);
  return ranked[0] ?? null;
}
