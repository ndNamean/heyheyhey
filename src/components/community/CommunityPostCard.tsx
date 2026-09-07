import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { usePointerCapabilities } from '../media-interaction/pointerCapabilities';
import {
  formatChatAttachmentBytes,
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from '../../lib/chatAttachmentDisplay';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import { isFamousVoteInFlight } from '../../lib/communityFamousVotes';
import { isAreaManagerTier, isOwner } from '../../lib/roles';
import { nowIso } from '../../lib/utils';
import type { CommunityPost, CommunityReaction, Profile } from '../../types';
import { MessageBody } from '../floating-assistant/MessageBody';
import IdentityWithAvatar from '../profileAvatar/IdentityWithAvatar';
import { shouldEnableSwipeFamous, useSwipeFamous } from '../../hooks/useSwipeFamous';
import CommunityReactions from './CommunityReactions';

export type CommunityPostCardVariant = 'feed' | 'famous' | 'detail';

export interface CommunityPostCardProps {
  post: CommunityPost;
  profile: Profile;
  reactions?: CommunityReaction[];
  famousVoted?: boolean;
  famousInFlight?: boolean;
  swipeEnabled?: boolean;
  variant?: CommunityPostCardVariant;
  onImageTap?: (post: CommunityPost) => void;
  onOpenDetail?: (post: CommunityPost) => void;
  onFamousToggle?: (post: CommunityPost) => void;
  /** Right-swipe casts Famous (does not toggle off). */
  onFamousCast?: (post: CommunityPost) => void;
  onSkip?: (postId: string) => void;
}

function formatPostTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function authorAvatarFields(post: CommunityPost): AvatarProfileFields {
  const linked = post.author;
  return {
    displayName: linked?.displayName || post.authorNameSnapshot || '',
    email: linked?.email || '',
    userId: linked?.userId || post.authorUserId,
    avatarFile: linked?.avatarFile,
    avatarPath: linked?.avatarPath,
    avatarUrl: linked?.avatarUrl,
  };
}

export default function CommunityPostCard({
  post,
  profile,
  reactions = [],
  famousVoted = false,
  famousInFlight = false,
  swipeEnabled = false,
  variant = 'feed',
  onImageTap,
  onOpenDetail,
  onFamousToggle,
  onFamousCast,
  onSkip,
}: CommunityPostCardProps) {
  const { t } = useLang();
  const copy = t.community;
  const { reducedMotion } = usePointerCapabilities();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const [modBusy, setModBusy] = useState(false);

  const name = post.authorNameSnapshot?.trim() || post.author?.displayName || '';
  const role = post.authorRoleSnapshot?.trim() || post.author?.role || '';
  const isOwn = post.authorUserId === profile.userId;
  const canModerate = isOwner(profile.role) || isAreaManagerTier(profile.role);
  const hasAttachment = messageHasChatAttachment(post);
  const attachmentUrl = resolveChatAttachmentUrl(post);
  const attachmentKind = String(post.attachmentKind || '').trim();
  const isImage = hasAttachment && attachmentKind === 'image';
  const isFile = hasAttachment && attachmentKind === 'file';
  const bodyTrimmed = post.body.trim();
  const commentCount = Math.max(0, Number(post.commentCount) || 0);
  const famousCount = Math.max(0, Number(post.famousVoteCount) || 0);
  const imageAlt = post.attachmentFileName || copy.photo;
  const width = Number.parseInt(post.attachmentWidth || '', 10) || undefined;
  const height = Number.parseInt(post.attachmentHeight || '', 10) || undefined;
  const voteBusy = famousInFlight || isFamousVoteInFlight(profile.userId, post.id);
  const allowSwipe =
    swipeEnabled &&
    variant !== 'detail' &&
    shouldEnableSwipeFamous(reducedMotion) &&
    !voteBusy;

  const { offsetX, dragging, swipeHandlers } = useSwipeFamous({
    enabled: allowSwipe,
    onFamous: () => (onFamousCast ?? onFamousToggle)?.(post),
    onSkip: () => onSkip?.(post.id),
  });

  async function updateStatus(status: 'hidden' | 'deleted') {
    if (modBusy) return;
    if (status === 'hidden' && !canModerate) return;
    if (status === 'deleted' && !isOwn && !canModerate) return;
    const confirmMsg = status === 'hidden' ? copy.confirmHide : copy.confirmDelete;
    if (!window.confirm(confirmMsg)) return;
    setModBusy(true);
    setModError(null);
    setMenuOpen(false);
    try {
      await db.transact(
        db.tx.communityPosts[post.id].update({
          status,
          deletedAt: status === 'deleted' ? nowIso() : post.deletedAt || '',
        }),
      );
    } catch (err) {
      setModError(
        err instanceof Error
          ? err.message
          : status === 'hidden'
            ? copy.hideFailed
            : copy.deleteFailed,
      );
    } finally {
      setModBusy(false);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, textarea, input, .community-reactions, .community-card-more')) {
      return;
    }
    swipeHandlers.onPointerDown(event);
  }

  const showMenu = isOwn || canModerate;

  return (
    <article
      className={`community-card${variant === 'famous' ? ' community-pin' : ''}`}
      data-post-id={post.id}
      style={
        allowSwipe
          ? {
              transform: `translateX(${offsetX}px)`,
              transition: dragging ? 'none' : 'transform 180ms ease',
              touchAction: 'pan-y',
            }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={swipeHandlers.onPointerMove}
      onPointerUp={swipeHandlers.onPointerUp}
      onPointerCancel={swipeHandlers.onPointerCancel}
      onClickCapture={swipeHandlers.onClickCapture}
    >
      <header className="community-card-header">
        <IdentityWithAvatar profile={authorAvatarFields(post)} size={32}>
          <span className="community-card-name">{name}</span>
        </IdentityWithAvatar>
        {role ? <span className="badge community-card-role">{role}</span> : null}
        <time className="community-card-time" dateTime={post.createdAt}>
          {formatPostTime(post.createdAt)}
        </time>
        {showMenu ? (
          <div className="community-card-more">
            <button
              type="button"
              className="secondary community-card-more-btn"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {copy.moreActions}
            </button>
            {menuOpen ? (
              <div className="community-card-more-menu" role="menu">
                {canModerate && post.status === 'active' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="secondary"
                    disabled={modBusy}
                    onClick={() => void updateStatus('hidden')}
                  >
                    {copy.hidePost}
                  </button>
                ) : null}
                {isOwn || canModerate ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    disabled={modBusy}
                    onClick={() => void updateStatus('deleted')}
                  >
                    {copy.deletePost}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {bodyTrimmed ? (
        <MessageBody body={post.body} candidates={[]} className="community-card-body" />
      ) : null}

      {isImage && attachmentUrl ? (
        <button
          type="button"
          className="community-card-image-btn"
          onClick={() => onImageTap?.(post)}
          aria-label={imageAlt}
        >
          <img
            className="community-card-image"
            src={attachmentUrl}
            alt={imageAlt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
          />
        </button>
      ) : null}

      {isFile ? (
        <a
          className="community-card-file"
          href={attachmentUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          download={post.attachmentFileName || undefined}
        >
          <span className="community-card-file-name">
            {post.attachmentFileName || copy.downloadFile}
          </span>
          <span className="community-card-file-meta">
            {[post.attachmentMimeType, formatChatAttachmentBytes(post.attachmentBytes)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </a>
      ) : null}

      <footer className="community-card-footer">
        {variant === 'detail' ? (
          <span className="community-card-comments">
            {copy.comments.replace('{count}', String(commentCount))}
          </span>
        ) : (
          <button
            type="button"
            className="community-card-comments-btn"
            onClick={() => onOpenDetail?.(post)}
          >
            {copy.comments.replace('{count}', String(commentCount))}
          </button>
        )}
        <button
          type="button"
          className={`community-famous-btn${famousVoted ? ' community-famous-btn--on' : ''}`}
          aria-pressed={famousVoted}
          disabled={voteBusy}
          onClick={() => onFamousToggle?.(post)}
        >
          {famousVoted ? copy.unchooseFamous : copy.chooseFamous}
          {famousCount > 0 ? (
            <span className="community-famous-count">
              {copy.famousCount.replace('{count}', String(famousCount))}
            </span>
          ) : null}
        </button>
        {modError ? <span className="community-card-error">{modError}</span> : null}
      </footer>

      <CommunityReactions post={post} reactions={reactions} userId={profile.userId} />
    </article>
  );
}
