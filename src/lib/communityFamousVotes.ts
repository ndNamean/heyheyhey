import { id } from '@instantdb/react';
import { db } from '../db';
import { applyCounterDelta } from './communityCounters';
import { nowIso } from './utils';

export const COMMUNITY_FAMOUS_UNDO_MS = 5000;

const inflightKeys = new Set<string>();

export function buildVoterPostKey(userId: string, postId: string): string {
  return `${userId.trim()}:${postId.trim()}`;
}

export function famousVoteMutationId(
  userId: string,
  postId: string,
  action: 'cast' | 'remove',
): string {
  return `${action}:${buildVoterPostKey(userId, postId)}`;
}

export function isFamousVoteInFlight(userId: string, postId: string): boolean {
  const key = buildVoterPostKey(userId, postId);
  return Boolean(key !== ':' && inflightKeys.has(key));
}

export type FamousVoteOk = {
  ok: true;
  action: 'cast' | 'remove' | 'noop';
  voteId: string | null;
};

export type FamousVoteErr = { ok: false; error: string };

export type FamousVoteResult = FamousVoteOk | FamousVoteErr;

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /unique|constraint|duplicate/i.test(msg);
}

async function withVoteLock<T>(
  userId: string,
  postId: string,
  run: () => Promise<T>,
): Promise<T | FamousVoteErr> {
  const key = buildVoterPostKey(userId, postId);
  if (!userId.trim() || !postId.trim()) {
    return { ok: false, error: 'Invalid famous vote' };
  }
  if (inflightKeys.has(key)) {
    return { ok: false, error: 'in-flight' };
  }
  inflightKeys.add(key);
  try {
    return await run();
  } finally {
    inflightKeys.delete(key);
  }
}

/**
 * Shared write used by the Famous button and right-swipe.
 * Idempotent: existing vote or unique voterPostKey → already voted.
 */
export async function castFamousVote(params: {
  postId: string;
  userId: string;
  famousVoteCount: number;
  existingVoteId?: string | null;
}): Promise<FamousVoteResult> {
  const postId = params.postId.trim();
  const userId = params.userId.trim();
  return withVoteLock(userId, postId, async () => {
    if (params.existingVoteId) {
      return { ok: true, action: 'noop', voteId: params.existingVoteId };
    }
    const voteId = id();
    const createdAt = nowIso();
    const voterPostKey = buildVoterPostKey(userId, postId);
    try {
      await db.transact([
        db.tx.communityFamousVotes[voteId]
          .update({
            postId,
            userId,
            voterPostKey,
            createdAt,
            clientMutationId: famousVoteMutationId(userId, postId, 'cast'),
          })
          .link({ post: postId }),
        db.tx.communityPosts[postId].update({
          famousVoteCount: applyCounterDelta(params.famousVoteCount, 1),
          lastActivityAt: createdAt,
        }),
      ]);
      return { ok: true, action: 'cast', voteId };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return { ok: true, action: 'noop', voteId: params.existingVoteId ?? null };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not vote Famous',
      };
    }
  });
}

export async function removeFamousVote(params: {
  postId: string;
  userId: string;
  famousVoteCount: number;
  existingVoteId: string;
}): Promise<FamousVoteResult> {
  const postId = params.postId.trim();
  const userId = params.userId.trim();
  const voteId = params.existingVoteId.trim();
  return withVoteLock(userId, postId, async () => {
    if (!voteId) return { ok: true, action: 'noop', voteId: null };
    const now = nowIso();
    try {
      await db.transact([
        db.tx.communityFamousVotes[voteId].delete(),
        db.tx.communityPosts[postId].update({
          famousVoteCount: applyCounterDelta(params.famousVoteCount, -1),
          lastActivityAt: now,
        }),
      ]);
      return { ok: true, action: 'remove', voteId: null };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not remove Famous vote',
      };
    }
  });
}

/** Canonical button toggle. Swipe always calls `castFamousVote` instead. */
export async function toggleFamousVote(params: {
  postId: string;
  userId: string;
  famousVoteCount: number;
  existingVoteId?: string | null;
}): Promise<FamousVoteResult> {
  if (params.existingVoteId) {
    return removeFamousVote({
      postId: params.postId,
      userId: params.userId,
      famousVoteCount: params.famousVoteCount,
      existingVoteId: params.existingVoteId,
    });
  }
  return castFamousVote(params);
}
