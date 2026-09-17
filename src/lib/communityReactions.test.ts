import { describe, expect, it } from 'vitest';
import { commentReactions, postReactions } from './communityReactions';
import type { CommunityReaction } from '../types';

function reaction(
  extra: Partial<CommunityReaction> & Pick<CommunityReaction, 'id'>,
): CommunityReaction {
  return {
    postId: 'post-a',
    userId: extra.userId || extra.id,
    commentId: '',
    reactionType: 'unicode',
    unicode: '❤️',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    createdAt: extra.createdAt || '2026-09-17T00:00:00.000Z',
    clientMutationId: extra.id,
    ...extra,
  };
}

describe('communityReactions selectors', () => {
  const rows = [
    reaction({ id: 'post-heart', unicode: '❤️' }),
    reaction({ id: 'c1-laugh', commentId: 'c1', unicode: '😂' }),
    reaction({ id: 'c2-heart', commentId: 'c2', unicode: '❤️' }),
    reaction({ id: 'c1-gif', commentId: 'c1', reactionType: 'giphy', unicode: '', giphyId: 'g1' }),
    reaction({ id: 'other-post', postId: 'post-b', unicode: '🔥' }),
    reaction({ id: 'blank-comment', commentId: '   ', unicode: '😮' }),
  ];

  it('keeps only empty-commentId rows for the post tray', () => {
    expect(postReactions(rows, 'post-a').map((row) => row.id)).toEqual([
      'post-heart',
      'blank-comment',
    ]);
    expect(postReactions(rows, 'post-a').some((row) => row.commentId.trim())).toBe(false);
  });

  it('scopes comment chips to postId + commentId and never shares across comments', () => {
    expect(commentReactions(rows, 'post-a', 'c1').map((row) => row.id)).toEqual([
      'c1-laugh',
      'c1-gif',
    ]);
    expect(commentReactions(rows, 'post-a', 'c2').map((row) => row.id)).toEqual(['c2-heart']);
    expect(commentReactions(rows, 'post-a', 'c1').some((row) => row.id === 'c2-heart')).toBe(false);
    expect(commentReactions(rows, 'post-a', '').map((row) => row.id)).toEqual([]);
    expect(commentReactions(rows, 'post-b', 'c1').map((row) => row.id)).toEqual([]);
  });
});
