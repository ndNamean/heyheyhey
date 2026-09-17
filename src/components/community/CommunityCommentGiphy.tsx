import { useState } from 'react';
import { GIPHY_ATTRIBUTION_URL, GIPHY_POWERED_BY_MARK } from '../../lib/giphyClient';
import {
  commentGiphyDisplayUrl,
  commentHasGiphyContent,
} from '../../lib/communityCommentGiphy';
import type { CommunityComment } from '../../types';

type Props = {
  comment: Pick<CommunityComment, 'giphyId' | 'giphyUrl' | 'giphyPreviewUrl' | 'giphyTitle'>;
  unavailableLabel: string;
};

/** Community comment-body GIF (not a reaction chip). */
export default function CommunityCommentGiphy({ comment, unavailableLabel }: Props) {
  const src = commentGiphyDisplayUrl(comment);
  const title = (comment.giphyTitle || '').trim();
  const [failed, setFailed] = useState(false);
  const hasContent = commentHasGiphyContent(comment) || Boolean(src);
  if (!hasContent) return null;

  const showImage = Boolean(src) && !failed;
  const alt = title || unavailableLabel;

  return (
    <figure className="community-comment-giphy">
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
      <a
        className="community-comment-giphy-attribution"
        href={GIPHY_ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {GIPHY_POWERED_BY_MARK}
      </a>
    </figure>
  );
}
