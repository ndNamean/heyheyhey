import { isPostReaction } from './communityReactionPeople';
import type { CommunityReaction } from '../types';

/** Post tray / post Ornament arc: this post and empty commentId. */
export function postReactions(
  rows: CommunityReaction[],
  postId: string,
): CommunityReaction[] {
  return rows.filter((row) => (row.postId || '') === postId && isPostReaction(row));
}

/** Comment/reply chips: this post and this comment id (never empty). */
export function commentReactions(
  rows: CommunityReaction[],
  postId: string,
  commentId: string,
): CommunityReaction[] {
  const cid = (commentId || '').trim();
  if (!cid) return [];
  return rows.filter(
    (row) => (row.postId || '') === postId && (row.commentId || '').trim() === cid,
  );
}
