import { useMemo, type CSSProperties } from 'react';
import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import { AUTHOR_IDLE_TOP_PCT, buildGalleryOrnamentLayout } from './galleryOrnaments';
import {
  ornamentRippleAuthorKey,
  ornamentRippleCommentKey,
  ornamentRippleReactionKey,
} from './ornamentRipple';

interface Props {
  post: CommunityPost;
  reactions: CommunityReaction[];
  comments: CommunityComment[];
  reactorProfiles: ReadonlyMap<string, AvatarProfileFields>;
}

function rippleStyle(leftPct: number, topPct: number): CSSProperties {
  return { left: `${leftPct}%`, top: `${topPct}%` };
}

function RippleMarks() {
  return (
    <>
      <span className="community-depth-ripple-ring" />
      <span className="community-depth-ripple-ring" />
      <span className="community-depth-ripple-ring" />
    </>
  );
}

export default function CommunityDepthRipples({
  post,
  reactions,
  comments,
  reactorProfiles,
}: Props) {
  const layout = useMemo(
    () =>
      buildGalleryOrnamentLayout({
        post,
        reactions,
        comments,
        reactorProfiles,
      }),
    [post, reactions, comments, reactorProfiles],
  );

  return (
    <>
      {layout.reactions.map((row) => {
        const key = ornamentRippleReactionKey(post.id, row.id);
        return (
          <div
            key={key}
            className="community-depth-ripple"
            data-ripple-key={key}
            style={rippleStyle(row.innerLeftPct, row.innerTopPct)}
          >
            <RippleMarks />
          </div>
        );
      })}
      {layout.comments.map((row) => {
        const key = ornamentRippleCommentKey(post.id, row.id);
        return (
          <div
            key={key}
            className="community-depth-ripple"
            data-ripple-key={key}
            style={rippleStyle(row.innerLeftPct, row.innerTopPct)}
          >
            <RippleMarks />
          </div>
        );
      })}
      <div
        className="community-depth-ripple"
        data-ripple-key={ornamentRippleAuthorKey(post.id)}
        style={rippleStyle(50, AUTHOR_IDLE_TOP_PCT)}
      >
        <RippleMarks />
      </div>
    </>
  );
}
