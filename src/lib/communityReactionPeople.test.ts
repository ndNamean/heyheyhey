import { describe, expect, it } from 'vitest';
import {
  indexProfilesByUserId,
  reactionPersonLabel,
  reactionWhoNames,
  uniqueReactionUserIds,
} from './communityReactionPeople';
import type { CommunityReaction } from '../types';

function reaction(userId: string, id = userId): CommunityReaction {
  return {
    id,
    postId: 'p1',
    userId,
    commentId: '',
    reactionType: 'unicode',
    unicode: '❤️',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    createdAt: '2026-09-08T00:00:00.000Z',
    clientMutationId: id,
  };
}

describe('uniqueReactionUserIds', () => {
  it('returns sorted unique ids and skips blanks', () => {
    expect(
      uniqueReactionUserIds([
        reaction('b'),
        reaction('a', 'a2'),
        reaction('a', 'a1'),
        reaction('  ', 'blank'),
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('reactionPersonLabel', () => {
  it('prefers display name, then email, then fallback', () => {
    expect(reactionPersonLabel({ displayName: 'Giathy', email: 'g@x' }, 'Someone')).toBe('Giathy');
    expect(reactionPersonLabel({ displayName: '  ', email: 'g@x' }, 'Someone')).toBe('g@x');
    expect(reactionPersonLabel(undefined, 'Someone')).toBe('Someone');
  });
});

describe('indexProfilesByUserId', () => {
  it('indexes the first profile per userId', () => {
    const map = indexProfilesByUserId([
      { userId: 'u1', displayName: 'A', email: 'a@x' },
      { userId: 'u1', displayName: 'A2', email: 'a2@x' },
      { userId: 'u2', displayName: 'B', email: 'b@x' },
    ]);
    expect(map.get('u1')?.displayName).toBe('A');
    expect(map.get('u2')?.displayName).toBe('B');
  });
});

describe('reactionWhoNames', () => {
  it('joins labels in userId order', () => {
    const map = indexProfilesByUserId([{ userId: 'u1', displayName: 'Ann', email: '' }]);
    expect(reactionWhoNames(['u1', 'u2'], map, 'Someone')).toBe('Ann, Someone');
  });
});
