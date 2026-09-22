import { useMemo, type CSSProperties } from 'react';
import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import ProfileAvatar from '../../profileAvatar/ProfileAvatar';
import {
  AUTHOR_IDLE_TOP_PCT,
  buildGalleryOrnamentLayout,
  type GalleryCommentOrnament,
  type PolarSlot,
} from './galleryOrnaments';

const AVATAR_PX = 22;

interface Props {
  post: CommunityPost;
  reactions: CommunityReaction[];
  comments: CommunityComment[];
  reactorProfiles: ReadonlyMap<string, AvatarProfileFields>;
}

function slotStyle(row: PolarSlot): CSSProperties {
  return {
    '--rest-left': row.leftPct,
    '--rest-top': row.topPct,
    '--inner-left': row.innerLeftPct,
    '--inner-top': row.innerTopPct,
  } as CSSProperties;
}

function commentClassName(row: GalleryCommentOrnament, isReply: boolean): string {
  const mediaUrl = row.contentGiphyUrl || row.contentPhotoUrl;
  const isPhoto = Boolean(row.contentPhotoUrl) && !row.contentGiphyUrl;
  const classes = ['community-depth-comment'];
  if (isReply) classes.push('community-depth-comment--reply');
  if (mediaUrl) classes.push(isPhoto ? 'community-depth-comment--photo' : 'community-depth-comment--giphy');
  return classes.join(' ');
}

function CommentOrnament({ row, isReply }: { row: GalleryCommentOrnament; isReply?: boolean }) {
  const mediaUrl = row.contentGiphyUrl || row.contentPhotoUrl;
  return (
    <div className={commentClassName(row, Boolean(isReply))} style={slotStyle(row)}>
      <ProfileAvatar profile={row.profile} size={AVATAR_PX} />
      <div className="community-depth-comment-text">
        <div className="community-depth-comment-copy">
          <div className="community-depth-comment-name">{row.name}</div>
          {row.body ? <div className="community-depth-comment-body">{row.body}</div> : null}
          {mediaUrl ? (
            <img
              className="community-depth-comment-giphy"
              src={mediaUrl}
              alt=""
              draggable={false}
            />
          ) : null}
        </div>
        {row.reactionBadges.length ? (
          <div className="community-depth-comment-badges">
            {row.reactionBadges.map((badge) =>
              badge.giphyUrl ? (
                <img
                  key={badge.key}
                  className="community-depth-comment-badge-giphy"
                  src={badge.giphyUrl}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span key={badge.key} className="community-depth-comment-badge-emoji">
                  {badge.unicode}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CommunityDepthOrnaments({
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
      {layout.reactions.length ? (
        <div className="community-depth-reacts">
          {layout.reactions.map((row) => (
            <div key={row.id} className="community-depth-react" style={slotStyle(row)}>
              <ProfileAvatar profile={row.profile} size={AVATAR_PX} />
              {row.giphyUrl ? (
                <img
                  className="community-depth-react-giphy"
                  src={row.giphyUrl}
                  alt=""
                  draggable={false}
                />
              ) : row.unicode ? (
                <span className="community-depth-react-emoji">{row.unicode}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="community-depth-below">
        <div
          className="community-depth-author"
          style={{ '--author-idle-top': AUTHOR_IDLE_TOP_PCT } as CSSProperties}
        >
          <ProfileAvatar profile={layout.author.profile} size={AVATAR_PX} />
          <div className="community-depth-author-text">
            <div className="community-depth-author-name">{layout.author.name}</div>
            {layout.author.body ? (
              <div className="community-depth-author-body">{layout.author.body}</div>
            ) : null}
          </div>
        </div>
        {layout.comments.map((row) => (
          <CommentOrnament key={row.id} row={row} />
        ))}
        {layout.replies.map((row) => (
          <CommentOrnament key={row.id} row={row} isReply />
        ))}
      </div>
    </>
  );
}
