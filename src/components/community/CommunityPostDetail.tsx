import { useMemo } from 'react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { BACK_PRIORITY, useNativeBack } from '../../lib/nativeBack';
import { isAreaManagerTier, isOwner } from '../../lib/roles';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import type { CommunityComment, CommunityPost, CommunityReaction, Profile } from '../../types';
import CommunityComments from './CommunityComments';
import CommunityPostCard from './CommunityPostCard';

interface Props {
  post: CommunityPost | null;
  profile: Profile;
  reactions: CommunityReaction[];
  reactorProfiles?: ReadonlyMap<string, AvatarProfileFields>;
  famousVoted: boolean;
  famousInFlight?: boolean;
  onClose: () => void;
  onImageTap?: (post: CommunityPost) => void;
  onFamousToggle?: (post: CommunityPost) => void;
  onFamousCast?: (post: CommunityPost) => void;
}

export default function CommunityPostDetail({
  post,
  profile,
  reactions,
  reactorProfiles,
  famousVoted,
  famousInFlight,
  onClose,
  onImageTap,
  onFamousToggle,
  onFamousCast,
}: Props) {
  const { t } = useLang();
  const copy = t.community;
  const canModerate = isOwner(profile.role) || isAreaManagerTier(profile.role);

  useNativeBack(
    () => {
      onClose();
      return true;
    },
    true,
    BACK_PRIORITY.MODAL,
  );

  const commentsQuery = useMemo(() => {
    if (!post?.id) return null;
    return {
      communityComments: {
        $: {
          where: { postId: post.id },
          order: { createdAt: 'asc' as const },
        },
        author: { avatarFile: {} },
      },
    };
  }, [post?.id]);

  const { data: commentData } = db.useQuery(commentsQuery);
  const comments = (commentData?.communityComments ?? []) as CommunityComment[];

  const available = Boolean(post && (post.status === 'active' || canModerate));

  return (
    <div
      className="community-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={copy.commentsTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="community-detail">
        <header className="community-detail-header">
          <h2>{copy.commentsTitle}</h2>
          <button type="button" className="secondary" onClick={onClose} aria-label={copy.closeDetail}>
            {t.common.close}
          </button>
        </header>
        {!available || !post ? (
          <p className="community-feed-status">{copy.postUnavailable}</p>
        ) : (
          <>
            <CommunityPostCard
              post={post}
              profile={profile}
              reactions={reactions}
              reactorProfiles={reactorProfiles}
              famousVoted={famousVoted}
              famousInFlight={famousInFlight}
              variant="detail"
              swipeEnabled={false}
              onImageTap={onImageTap}
              onFamousToggle={onFamousToggle}
              onFamousCast={onFamousCast}
            />
            <CommunityComments post={post} comments={comments} profile={profile} />
          </>
        )}
      </div>
    </div>
  );
}
