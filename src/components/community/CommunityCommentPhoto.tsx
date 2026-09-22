import { useState } from 'react';
import {
  commentHasPhotoContent,
  commentPhotoDisplayUrl,
} from '../../lib/communityCommentPhoto';
import type { CommunityComment } from '../../types';

type Props = {
  comment: Pick<
    CommunityComment,
    | 'attachmentKind'
    | 'attachmentPath'
    | 'attachmentFileId'
    | 'attachmentUrl'
    | 'attachmentFile'
    | 'attachmentFileName'
  >;
  unavailableLabel: string;
};

/** Community comment-body photo (not a GIF, not a reaction). */
export default function CommunityCommentPhoto({ comment, unavailableLabel }: Props) {
  const src = commentPhotoDisplayUrl(comment);
  const title = (comment.attachmentFileName || '').trim();
  const [failed, setFailed] = useState(false);
  if (!commentHasPhotoContent(comment)) return null;

  const showImage = Boolean(src) && !failed;
  const alt = title || unavailableLabel;

  return (
    <figure className="community-comment-giphy community-comment-photo">
      {showImage ? (
        <img
          className="community-comment-giphy-img"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="community-comment-giphy-fallback" role="img" aria-label={unavailableLabel}>
          {title || unavailableLabel}
        </div>
      )}
    </figure>
  );
}
