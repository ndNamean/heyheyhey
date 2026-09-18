import { lazy, Suspense, useMemo, useRef, useState, type FormEvent } from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { applyCounterDelta, uniqueCommenterDelta } from '../../lib/communityCounters';
import {
  COMMENT_MAX_BODY,
  buildCommunityCommentGiphyPayload,
  canSendCommunityComment,
  commentHasGiphyContent,
} from '../../lib/communityCommentGiphy';
import {
  buildCommunityCommentPhotoPayload,
  commentHasPhotoContent,
  commentPhotoPayloadFromUpload,
  emptyCommunityCommentPhotoFields,
} from '../../lib/communityCommentPhoto';
import { chatAttachmentPolicyErrorCopy } from '../../lib/chatAttachmentDisplay';
import { validateChatAttachmentPolicy } from '../../lib/chatAttachmentPolicy';
import { uploadChatAttachment } from '../../lib/chatAttachmentUpload';
import { isGiphyConfigured, type GiphyMediaItem } from '../../lib/giphyClient';
import { isAreaManagerTier, isOwner } from '../../lib/roles';
import { nowIso } from '../../lib/utils';
import type { CommunityComment, CommunityPost, CommunityReaction, Profile } from '../../types';
import { MessageBody } from '../floating-assistant/MessageBody';
import { ChatAttachmentPreview } from '../floating-assistant/ChatAttachmentPreview';
import { useChatAttachmentStaging } from '../floating-assistant/useChatAttachmentStaging';
import { GiphyMediaPreview } from '../floating-assistant/GiphyMediaPreview';
import IdentityWithAvatar from '../profileAvatar/IdentityWithAvatar';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import CommunityCommentGiphy from './CommunityCommentGiphy';
import CommunityCommentPhoto from './CommunityCommentPhoto';
import CommunityCommentReactions from './CommunityCommentReactions';

const GiphyPicker = lazy(() =>
  import('../floating-assistant/GiphyPicker').then((m) => ({ default: m.GiphyPicker })),
);

interface Props {
  post: CommunityPost;
  comments: CommunityComment[];
  profile: Profile;
  reactions?: CommunityReaction[];
  reactorProfiles?: ReadonlyMap<string, AvatarProfileFields>;
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

export default function CommunityComments({
  post,
  comments,
  profile,
  reactions = [],
  reactorProfiles,
}: Props) {
  const { t } = useLang();
  const copy = t.community;
  const sc = t.storeChat;
  const [draft, setDraft] = useState('');
  const [stagedGiphy, setStagedGiphy] = useState<GiphyMediaItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replyToId, setReplyToId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const giphyBtnRef = useRef<HTMLButtonElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const sendingLock = useRef(false);
  const giphyConfigured = isGiphyConfigured();
  const attachmentStaging = useChatAttachmentStaging({
    onStageAttachment: () => {
      setStagedGiphy(null);
      setPickerOpen(false);
    },
  });

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
  const canSend = canSendCommunityComment(draft, stagedGiphy, attachmentStaging.staged);

  function clearStagedPhoto() {
    attachmentStaging.clear();
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file || sendingLock.current) return;
    const mimeType = String(file.type || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const policy = validateChatAttachmentPolicy({
      mimeType,
      bytes: file.size,
      fileName: file.name,
    });
    if (!policy.ok || policy.kind !== 'image') {
      setError(chatAttachmentPolicyErrorCopy(policy.errorCode || 'invalid_type', sc));
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    const result = await attachmentStaging.stageFile(file);
    if (!result.ok) {
      setError(chatAttachmentPolicyErrorCopy(result.error.code, sc));
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    setError(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  async function sendComment() {
    const body = draft.trim().slice(0, COMMENT_MAX_BODY);
    if (!canSendCommunityComment(body, stagedGiphy, attachmentStaging.staged)) return;
    if (sendingLock.current) return;
    if (!isActive(post.status)) return;
    sendingLock.current = true;
    setSending(true);
    setError(null);
    const parentId = replyTarget
      ? threadParentId(replyTarget, byId) || replyTarget.id
      : '';
    let commentId = id();
    let clientMutationId = commentId;
    const createdAt = nowIso();
    const uniqueDelta = uniqueCommenterDelta(
      activeComments.map((row) => ({ userId: row.authorUserId })),
      profile.userId,
      'add',
    );
    const staged = attachmentStaging.staged;
    const giphyFields = staged
      ? buildCommunityCommentGiphyPayload(null)
      : buildCommunityCommentGiphyPayload(stagedGiphy);
    let photoFields = emptyCommunityCommentPhotoFields();
    let attachmentFileId = '';
    try {
      if (staged) {
        const ids = attachmentStaging.ensureSendIds(() => id());
        commentId = ids.messageId;
        clientMutationId = ids.clientMutationId;
        const cached = attachmentStaging.getCachedUpload();
        let uploaded = cached;
        if (cached) {
          attachmentStaging.markSending();
        } else {
          let progressTimer: number | null = null;
          try {
            attachmentStaging.markUploading(18);
            let fakeProgress = 18;
            progressTimer = window.setInterval(() => {
              fakeProgress = Math.min(88, fakeProgress + 10);
              attachmentStaging.bumpUploadProgress(fakeProgress);
            }, 280);
            uploaded = await uploadChatAttachment({
              blob: staged.blob,
              mimeType: staged.mimeType,
              fileName: staged.fileName,
              scope: 'community',
              postId: post.id,
              messageId: commentId,
              clientMutationId,
              enabled: true,
            });
            attachmentStaging.cacheUpload(uploaded);
            attachmentStaging.markSending();
          } catch (err) {
            const message = err instanceof Error ? err.message : copy.commentFailed;
            attachmentStaging.markFailed(message);
            setError(message);
            sendingLock.current = false;
            setSending(false);
            return;
          } finally {
            if (progressTimer !== null) window.clearInterval(progressTimer);
          }
        }
        if (!uploaded) {
          attachmentStaging.markFailed(sc.uploadFailed);
          setError(sc.uploadFailed);
          sendingLock.current = false;
          setSending(false);
          return;
        }
        attachmentFileId = uploaded.fileId;
        photoFields = buildCommunityCommentPhotoPayload(
          commentPhotoPayloadFromUpload(uploaded, {
            width: staged.width ?? undefined,
            height: staged.height ?? undefined,
          }),
        );
      }
      const linkAttrs: Record<string, string> = { post: post.id, author: profile.id };
      if (attachmentFileId) linkAttrs.attachmentFile = attachmentFileId;
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
            ...giphyFields,
            ...photoFields,
            createdAt,
            status: 'active',
            deletedAt: '',
            clientMutationId,
          })
          .link(linkAttrs),
        db.tx.communityPosts[post.id].update({
          commentCount: applyCounterDelta(post.commentCount, 1),
          uniqueCommenterCount: applyCounterDelta(post.uniqueCommenterCount, uniqueDelta),
          lastActivityAt: createdAt,
        }),
      ]);
      setDraft('');
      setStagedGiphy(null);
      clearStagedPhoto();
      setPickerOpen(false);
      setReplyToId('');
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.commentFailed;
      setError(message);
      if (staged) attachmentStaging.markFailed(message);
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await sendComment();
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
    const body = (comment.body || '').trim();
    if (!active && !canModerate) return null;
    return (
      <li key={comment.id} className={`community-comment${isReply ? ' community-comment--reply' : ''}${active ? '' : ' community-comment--muted'}`}>
        <IdentityWithAvatar profile={commentAvatar(comment)} size={24}>
          <span className="community-comment-name">{name}</span>
        </IdentityWithAvatar>
        {active ? (
          <>
            {commentHasGiphyContent(comment) ? (
              <CommunityCommentGiphy comment={comment} unavailableLabel={copy.commentGifUnavailable} />
            ) : null}
            {commentHasPhotoContent(comment) ? (
              <CommunityCommentPhoto comment={comment} unavailableLabel={copy.commentPhotoUnavailable} />
            ) : null}
            {body ? (
              <MessageBody body={comment.body} candidates={[]} className="community-comment-body" />
            ) : null}
            <CommunityCommentReactions
              post={post}
              commentId={comment.id}
              reactions={reactions}
              userId={profile.userId}
              reactorProfiles={reactorProfiles}
            />
          </>
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
          {stagedGiphy ? (
            <GiphyMediaPreview
              item={stagedGiphy}
              onClear={() => setStagedGiphy(null)}
              className="community-comment-giphy-preview"
              hint={copy.commentGifReady}
              removeLabel={copy.removeCommentGif}
              previewAriaLabel={copy.commentGifPreview}
            />
          ) : null}
          {attachmentStaging.staged ? (
            <ChatAttachmentPreview
              item={attachmentStaging.staged}
              phase={attachmentStaging.phase}
              uploadProgress={attachmentStaging.uploadProgress}
              className="community-comment-giphy-preview"
              hint={copy.commentPhotoReady}
              statusLabel={
                attachmentStaging.phase === 'preparing'
                  ? sc.preparingAttachment
                  : attachmentStaging.phase === 'uploading'
                    ? sc.uploadingAttachment.replace(
                        '{percent}',
                        String(Math.round(attachmentStaging.uploadProgress)),
                      )
                    : attachmentStaging.phase === 'sending'
                      ? sc.sendingAttachment
                      : attachmentStaging.phase === 'failed'
                        ? sc.uploadFailed
                        : undefined
              }
              onClear={clearStagedPhoto}
              onRetry={() => void sendComment()}
              removeLabel={copy.removeCommentPhoto}
              retryLabel={t.common.retry}
              previewAriaLabel={copy.commentPhotoPreview}
            />
          ) : null}
          <div className="community-comment-composer-actions">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                void onPickPhoto(file);
              }}
            />
            <button
              type="button"
              className="community-react-btn community-comment-gif-btn"
              disabled={sending}
              aria-label={copy.addCommentPhoto}
              onClick={() => photoInputRef.current?.click()}
            >
              {copy.addCommentPhoto}
            </button>
            {giphyConfigured ? (
              <button
                ref={giphyBtnRef}
                type="button"
                className="community-react-btn community-comment-gif-btn"
                disabled={sending}
                aria-label={copy.addCommentGif}
                onClick={() => setPickerOpen(true)}
              >
                {copy.addCommentGif}
              </button>
            ) : null}
            <button type="submit" disabled={sending || !canSend}>
              {sending ? copy.commenting : copy.sendComment}
            </button>
          </div>
        </form>
      ) : null}

      {pickerOpen && giphyConfigured ? (
        <Suspense fallback={null}>
          <GiphyPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            anchorRef={giphyBtnRef}
            onSelect={(item) => {
              clearStagedPhoto();
              setStagedGiphy(item);
              setPickerOpen(false);
            }}
          />
        </Suspense>
      ) : null}

      {error ? <p className="community-card-error">{error}</p> : null}
    </section>
  );
}
