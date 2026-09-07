import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactMock = vi.fn(async (..._args: unknown[]) => undefined);
const voteUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'voteTx', value, links }),
}));
const voteDeleteMock = vi.fn((_id?: string) => ({ type: 'voteDelete' }));
const postUpdateMock = vi.fn((value: Record<string, unknown>) => ({ type: 'postTx', value }));

vi.mock('@instantdb/react', () => ({ id: () => 'vote-new' }));
vi.mock('../db', () => ({
  db: {
    transact: (...args: unknown[]) => transactMock(args[0]),
    tx: {
      communityFamousVotes: new Proxy(
        {},
        {
          get: (_target, prop: string) => ({
            update: voteUpdateMock,
            delete: () => voteDeleteMock(prop),
          }),
        },
      ),
      communityPosts: new Proxy(
        {},
        {
          get: () => ({
            update: postUpdateMock,
          }),
        },
      ),
    },
  },
}));
vi.mock('./utils', () => ({ nowIso: () => '2026-09-07T12:00:00.000Z' }));

import {
  buildVoterPostKey,
  castFamousVote,
  famousVoteMutationId,
  removeFamousVote,
  toggleFamousVote,
} from './communityFamousVotes';

describe('voterPostKey', () => {
  it('is userId:postId', () => {
    expect(buildVoterPostKey('u1', 'p1')).toBe('u1:p1');
    expect(buildVoterPostKey(' u1 ', ' p1 ')).toBe('u1:p1');
    expect(famousVoteMutationId('u1', 'p1', 'cast')).toBe('cast:u1:p1');
    expect(famousVoteMutationId('u1', 'p1', 'remove')).toBe('remove:u1:p1');
  });
});

describe('famous vote toggle', () => {
  beforeEach(() => {
    transactMock.mockClear();
    voteUpdateMock.mockClear();
    voteDeleteMock.mockClear();
    postUpdateMock.mockClear();
  });

  it('cast writes voterPostKey and increments famousVoteCount', async () => {
    const result = await castFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 2,
    });
    expect(result).toEqual({ ok: true, action: 'cast', voteId: 'vote-new' });
    expect(voteUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 'p1',
        userId: 'u1',
        voterPostKey: 'u1:p1',
        clientMutationId: 'cast:u1:p1',
      }),
    );
    expect(postUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ famousVoteCount: 3 }),
    );
  });

  it('cast is a noop when already voted', async () => {
    const result = await castFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 2,
      existingVoteId: 'vote-1',
    });
    expect(result).toEqual({ ok: true, action: 'noop', voteId: 'vote-1' });
    expect(transactMock).not.toHaveBeenCalled();
  });

  it('remove deletes the vote and decrements the count', async () => {
    const result = await removeFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 2,
      existingVoteId: 'vote-1',
    });
    expect(result).toEqual({ ok: true, action: 'remove', voteId: null });
    expect(voteDeleteMock).toHaveBeenCalledWith('vote-1');
    expect(postUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ famousVoteCount: 1 }),
    );
  });

  it('button toggle casts when absent and removes when present', async () => {
    const added = await toggleFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 0,
    });
    expect(added.ok && added.action).toBe('cast');

    const removed = await toggleFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 1,
      existingVoteId: 'vote-1',
    });
    expect(removed.ok && removed.action).toBe('remove');
  });

  it('treats a unique-constraint create as already voted', async () => {
    transactMock.mockRejectedValueOnce(new Error('unique constraint voterPostKey'));
    const result = await castFamousVote({
      postId: 'p1',
      userId: 'u1',
      famousVoteCount: 0,
    });
    expect(result).toEqual({ ok: true, action: 'noop', voteId: null });
  });
});
