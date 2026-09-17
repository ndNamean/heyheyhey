import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import type { CommunityPost, CommunityReaction } from '../../types';
import CommunityReactions from './CommunityReactions';

type Props = {
  post: CommunityPost;
  commentId: string;
  reactions: CommunityReaction[];
  userId: string;
  reactorProfiles?: ReadonlyMap<string, AvatarProfileFields>;
};

/** Comment/reply reaction tray — never writes empty commentId or uniqueReactorCount. */
export default function CommunityCommentReactions({
  post,
  commentId,
  reactions,
  userId,
  reactorProfiles,
}: Props) {
  const scoped = (commentId || '').trim();
  if (!scoped) return null;
  return (
    <CommunityReactions
      post={post}
      commentId={scoped}
      reactions={reactions}
      userId={userId}
      reactorProfiles={reactorProfiles}
    />
  );
}
