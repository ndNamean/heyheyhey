import { useMemo, useState, type FormEvent } from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { applyCounterDelta, uniqueCommenterDelta } from '../../lib/communityCounters';
import { isAreaManagerTier, isOwner } from '../../lib/roles';
import { nowIso } from '../../lib/utils';
import type { CommunityComment, CommunityPost, Profile } from '../../types';
import { MessageBody } from '../floating-assistant/MessageBody';
import IdentityWithAvatar from '../profileAvatar/IdentityWithAvatar';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';

const COMMENT_MAX_BODY = 2000;

interface Props {
  post: CommunityPost;
  comments: CommunityComment[];
  profile: Profile;
}

function commentAvatar(comment: CommunityComment): AvatarProfileFields {
  const linked = comment.author;
  return {
    displayName: linked?.displayName || comment.authorNameSnapshot || '',
    email: linked?.email || '',
    userId: linked?.userId || comment.authorUserId,
    avatarFile: linked?.avatarFile,
    avatarPath: linked?.avatarPath,
    avatarUrl: linked?.avatarUrl,
  };
}

function isActive(status: string): boolean {
  return (status || '').trim() === 'active';
}

function threadParentId(comment: CommunityComment, byId: Map<string, CommunityComment>): string {
  const parentId = (comment.parentId || '').trim();
  if (!parentId) return '';
  const parent = byId.get(parentId);
  if (!parent) return parentId;
  const grand = (parent.parentId || '').trim();
  return grand || parent.id;
}

export default function CommunityComments({ post, comments, profile }: Props) {
  const { t } = useLang();
  const copy = t.community;
  const [draft, setDraft] = useState('');
  const [replyToId, setReplyToId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');

  const canModerate = isOwner(profile.role) || isAreaManagerTier(profile.role);
  const byId = useMemo(() => {
    const map = new Map<string, CommunityComment>();
    for (const row of comments) map.set(row.id, row);
    return map;
  }, [comments]);

  const threads = useMemo(() => {
    const top: CommunityComment[] = [];
    const replies = new Map<string, CommunityComment[]>();
    for (const row of comments) {
      const parent = threadParentId(row, byId);
      if (!parent) {
        top.push(row);
        continue;
      }
      const list = replies.get(parent) ?? [];
      list.push(row);
      replies.set(parent, list);
    }
    top.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const list of replies.values()) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    return { top, replies };
  }, [byId, comments]);

  const activeComments = comments.filter((row) => isActive(row.status));
  const replyTarget = replyToId ? byId.get(replyToId) : undefined;
  const placeholder = replyTarget ? copy.replyPlaceholder : copy.commentPlaceholder;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim().slice(0, COMMENT_MAX_BODY);
    if (!body || sending) return;
    if (!isActive(post.status)) return;
    setSending(true);
    setError(null);
    const parentId = replyTarget
      ? threadParentId(replyTarget, byId) || replyTarget.id
      : '';
    const commentId = id();
    const createdAt = nowIso();
    const uniqueDelta = uniqueCommenterDelta(
      activeComments.map((row) => ({ userId: row.authorUserId })),
      profile.userId,
      'add',
    );
    try {
      await db.transact([
        db.tx.communityComments[commentId]
          .update({
            postId: post.id,
            parentId,
            authorUserId: profile.userId,
            authorProfileId: profile.id,
            authorNameSnapshot: profile.displayName || profile.email || 'You',
            authorRoleSnapshot: profile.role || '',
            body,
            createdAt,
            status: 'active',
            deletedAt: '',
            clientMutationId: commentId,
          })
          .link({ post: post.id, author: profile.id }),
        db.tx.communityPosts[post.id].update({
          commentCount: applyCounterDelta(post.commentCount, 1),
          uniqueCommenterCount: applyCounterDelta(post.uniqueCommenterCount, uniqueDelta),
          lastActivityAt: createdAt,
        }),
      ]);
      setDraft('');
      setReplyToId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.commentFailed);
    } finally {
      setSending(false);
    }
  }

  async function moderateComment(comment: CommunityComment, nextStatus: 'hidden' | 'deleted') {
    if (busyId) return;
    const isOwn = comment.authorUserId === profile.userId;
    if (nextStatus === 'hidden' && !canModerate) return;
    if (nextStatus === 'deleted' && !isOwn && !canModerate) return;
    const confirmMsg = nextStatus === 'hidden' ? copy.confirmHideComment : copy.confirmDeleteComment;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(comment.id);
    setError(null);
    const wasActive = isActive(comment.status);
    const uniqueDelta = wasActive
      ? uniqueCommenterDelta(
          activeComments.map((row) => ({ userId: row.authorUserId })),
          comment.authorUserId,
          'remove',
        )
      : 0;
    try {
      await db.transact([
        db.tx.communityComments[comment.id].update({
          status: nextStatus,
          deletedAt: nextStatus === 'deleted' ? nowIso() : comment.deletedAt || '',
        }),
        db.tx.communityPosts[post.id].update({
          commentCount: applyCounterDelta(post.commentCount, wasActive ? -1 : 0),
          uniqueCommenterCount: applyCounterDelta(post.uniqueCommenterCount, uniqueDelta),
          lastActivityAt: nowIso(),
        }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.commentFailed);
    } finally {
      setBusyId('');
    }
  }

  function renderComment(comment: CommunityComment, isReply: boolean) {
    const active = isActive(comment.status);
    const name = comment.authorNameSnapshot?.trim() || comment.author?.displayName || '';
    const isOwn = comment.authorUserId === profile.userId;
    if (!active && !canModerate) return null;
    return (
      <li key={comment.id} className={`community-comment${isReply ? ' community-comment--reply' : ''}${active ? '' : ' community-comment--muted'}`}>
        <IdentityWithAvatar profile={commentAvatar(comment)} size={24}>
          <span className="community-comment-name">{name}</span>
        </IdentityWithAvatar>
        {active ? (
          <MessageBody body={comment.body} candidates={[]} className="community-comment-body" />
        ) : (
          <p className="community-comment-body">
            {comment.status === 'hidden' ? copy.commentHidden : copy.commentDeleted}
          </p>
        )}
        <div className="community-comment-actions">
          {active && !isReply ? (
            <button type="button" className="secondary" onClick={() => setReplyToId(comment.id)}>
              {copy.replyAction}
            </button>
          ) : null}
          {active && isOwn ? (
            <button
              type="button"
              className="danger"
              disabled={busyId === comment.id}
              onClick={() => void moderateComment(comment, 'deleted')}
            >
              {copy.deleteComment}
            </button>
          ) : null}
          {active && canModerate ? (
            <button
              type="button"
              className="secondary"
              disabled={busyId === comment.id}
              onClick={() => void moderateComment(comment, 'hidden')}
            >
              {copy.hideComment}
            </button>
          ) : null}
          {active && canModerate && !isOwn ? (
            <button
              type="button"
              className="danger"
              disabled={busyId === comment.id}
              onClick={() => void moderateComment(comment, 'deleted')}
            >
              {copy.deleteComment}
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section className="community-comments" aria-label={copy.commentsTitle}>
      <h3>{copy.commentsTitle}</h3>
      {threads.top.length === 0 ? (
        <p className="small community-feed-empty">{copy.noComments}</p>
      ) : (
        <ul className="community-comment-list">
          {threads.top.map((top) => (
            <li key={top.id} className="community-comment-thread">
              <ul>
                {renderComment(top, false)}
                {(threads.replies.get(top.id) ?? []).map((reply) => renderComment(reply, true))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {isActive(post.status) ? (
        <form className="community-comment-composer" onSubmit={(e) => void submit(e)}>
          {replyTarget ? (
            <div className="community-comment-replying">
              {copy.replyAction}: {replyTarget.authorNameSnapshot || replyTarget.author?.displayName}
              <button type="button" className="secondary" onClick={() => setReplyToId('')}>
                {t.common.close}
              </button>
            </div>
          ) : null}
          <textarea
            className="community-comment-input"
            rows={2}
            maxLength={COMMENT_MAX_BODY}
            placeholder={placeholder}
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX_BODY))}
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? copy.commenting : copy.sendComment}
          </button>
        </form>
      ) : null}
      {error ? <p className="community-card-error">{error}</p> : null}
    </section>
  );
}
