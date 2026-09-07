import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { uploadChatAttachment } from '../../lib/chatAttachmentUpload';
import { isChatAttachmentsEnabled } from '../../lib/chatAttachmentsFlag';
import { chatAttachmentPolicyErrorCopy } from '../../lib/chatAttachmentDisplay';
import { BACK_PRIORITY, useNativeBack } from '../../lib/nativeBack';
import {
  attachmentInputToFields,
  emptyStoreChatAttachmentFields,
  type ChatAttachmentPayloadInput,
} from '../../lib/storeChatMediaPayload';
import { nowIso } from '../../lib/utils';
import type { Profile } from '../../types';
import { pickMoodForPostId, HEY_PELO_FALLBACK_MOOD } from './depth-gallery/communityGalleryMoods';
import { ChatAttachmentPreview } from '../floating-assistant/ChatAttachmentPreview';
import { ChatDropOverlay } from '../floating-assistant/ChatDropOverlay';
import {
  ComposerAttachMenu,
  buildQuickMessageLabels,
} from '../floating-assistant/ComposerAttachMenu';
import { useChatAttachmentStaging } from '../floating-assistant/useChatAttachmentStaging';
import { useComposerVisualState } from '../floating-assistant/useComposerVisualState';

interface Props {
  profile: Profile;
  onClose: () => void;
}

/** Same cap as STORE_CHAT_MAX_BODY / Instant `bodySizeValid`. */
const COMMUNITY_POST_MAX_BODY = 2000;

function emptyMoodFields() {
  return {
    moodBackgroundColor: '',
    moodBlob1Color: '',
    moodBlob2Color: '',
  };
}

function moodFieldsForImagePost(postId: string) {
  const mood = pickMoodForPostId(postId) ?? HEY_PELO_FALLBACK_MOOD;
  return {
    moodBackgroundColor: mood.backgroundColor,
    moodBlob1Color: mood.blob1Color,
    moodBlob2Color: mood.blob2Color,
  };
}

export default function CommunityComposer({ profile, onClose }: Props) {
  const { t } = useLang();
  const copy = t.community;
  const sc = t.storeChat;
  const attachmentsEnabled = isChatAttachmentsEnabled();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const sendingLock = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const composerVisual = useComposerVisualState({ enabled: true });
  const attachmentStaging = useChatAttachmentStaging();

  useNativeBack(
    () => {
      if (sendingLock.current) return true;
      onClose();
      return true;
    },
    true,
    BACK_PRIORITY.MODAL,
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textareaRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const policyErrorMessage = useCallback(
    (code?: string) => chatAttachmentPolicyErrorCopy(code, sc),
    [sc],
  );

  const stageIncomingFile = useCallback(
    (file: File) => {
      void attachmentStaging.stageFile(file).then((result) => {
        if (!result.ok) {
          setSendError(policyErrorMessage(result.error.code));
          return;
        }
        setSendError(null);
        setAttachMenuOpen(false);
      });
    },
    [attachmentStaging, policyErrorMessage],
  );

  function updateDraft(next: string) {
    setDraft(next.slice(0, COMMUNITY_POST_MAX_BODY));
    composerVisual.onInput();
  }

  function insertQuickMessage(text: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    const next =
      draft.slice(0, start) +
      (draft.slice(0, start) && !/\s$/.test(draft.slice(0, start)) ? ' ' : '') +
      text +
      draft.slice(end);
    updateDraft(next.slice(0, COMMUNITY_POST_MAX_BODY));
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = Math.min(start + text.length + 1, ta.value.length);
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  }

  const trimmed = draft.trim();
  const canSubmit =
    (Boolean(trimmed) || (attachmentsEnabled && attachmentStaging.hasStaged)) &&
    !sending &&
    !sendingLock.current;

  async function publish() {
    if (!canSubmit) return;
    if (sendingLock.current) return;
    sendingLock.current = true;
    setSending(true);
    setSendError(null);
    composerVisual.setSending();

    const body = trimmed.slice(0, COMMUNITY_POST_MAX_BODY);
    let attachmentPayload: ChatAttachmentPayloadInput | null = null;
    let postId = id();
    let clientMutationId = id();
    const staged = attachmentStaging.staged;

    if (staged && attachmentsEnabled) {
      const ids = attachmentStaging.ensureSendIds(() => id());
      postId = ids.messageId;
      clientMutationId = ids.clientMutationId;
      const cached = attachmentStaging.getCachedUpload();
      if (cached) {
        attachmentStaging.markSending();
        attachmentPayload = attachmentStaging.toPayloadInput(cached);
        if (!attachmentPayload) {
          attachmentStaging.markFailed(sc.uploadFailed);
          setSendError(sc.uploadFailed);
          composerVisual.setFailure();
          sendingLock.current = false;
          setSending(false);
          return;
        }
      } else {
        let progressTimer: number | null = null;
        try {
          attachmentStaging.markUploading(18);
          let fakeProgress = 18;
          progressTimer = window.setInterval(() => {
            fakeProgress = Math.min(88, fakeProgress + 10);
            attachmentStaging.bumpUploadProgress(fakeProgress);
          }, 280);
          const uploaded = await uploadChatAttachment({
            blob: staged.blob,
            mimeType: staged.mimeType,
            fileName: staged.fileName,
            scope: 'community',
            postId,
            messageId: postId,
            clientMutationId,
          });
          attachmentStaging.cacheUpload(uploaded);
          attachmentStaging.markSending();
          attachmentPayload = attachmentStaging.toPayloadInput(uploaded);
          if (!attachmentPayload) {
            throw new Error(sc.uploadFailed);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : sc.uploadFailed;
          attachmentStaging.markFailed(message);
          setSendError(message);
          composerVisual.setFailure();
          sendingLock.current = false;
          setSending(false);
          return;
        } finally {
          if (progressTimer !== null) window.clearInterval(progressTimer);
        }
      }
    }

    const attachmentFields = attachmentPayload
      ? attachmentInputToFields(attachmentPayload)
      : emptyStoreChatAttachmentFields();
    const isImage = attachmentFields.attachmentKind === 'image';
    const moodFields = isImage ? moodFieldsForImagePost(postId) : emptyMoodFields();
    const createdAt = nowIso();
    const linkAttrs: Record<string, string> = { author: profile.id };
    if (attachmentPayload?.fileId) {
      linkAttrs.attachmentFile = attachmentPayload.fileId;
    }

    try {
      await db.transact(
        db.tx.communityPosts[postId]
          .update({
            authorUserId: profile.userId,
            authorProfileId: profile.id,
            authorNameSnapshot: profile.displayName || profile.email || 'You',
            authorRoleSnapshot: profile.role || '',
            body,
            createdAt,
            updatedAt: createdAt,
            status: 'active',
            deletedAt: '',
            clientMutationId,
            ...attachmentFields,
            famousVoteCount: 0,
            uniqueReactorCount: 0,
            uniqueCommenterCount: 0,
            commentCount: 0,
            lastActivityAt: createdAt,
            ...moodFields,
          })
          .link(linkAttrs),
      );
      attachmentStaging.clear();
      composerVisual.setSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.postFailed;
      setSendError(message);
      if (attachmentPayload) attachmentStaging.markFailed(message);
      composerVisual.setFailure();
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void publish();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void publish();
    }
  }

  const form = (
    <form
      className={`community-composer-form${attachmentsEnabled ? ' community-composer-form--with-attach' : ''}`}
      onSubmit={handleSubmit}
      data-composer-state={composerVisual.state}
    >
      {attachmentStaging.staged ? (
        <ChatAttachmentPreview
          item={attachmentStaging.staged}
          phase={attachmentStaging.phase}
          uploadProgress={attachmentStaging.uploadProgress}
          hint={copy.readyToPost}
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
          onClear={() => attachmentStaging.clear()}
          onRetry={() => void publish()}
          removeLabel={sc.removeAttachment}
          retryLabel={t.common.retry}
          previewAriaLabel={sc.attachmentPreview}
        />
      ) : null}

      <div className="community-composer-row">
        {attachmentsEnabled ? (
          <button
            type="button"
            ref={attachBtnRef}
            className="fa-composer-attach"
            disabled={sending}
            aria-label={sc.attach}
            aria-haspopup="dialog"
            aria-expanded={attachMenuOpen}
            onClick={() => setAttachMenuOpen((v) => !v)}
          >
            +
          </button>
        ) : null}

        <textarea
          ref={textareaRef}
          className="community-composer-input"
          rows={4}
          disabled={sending}
          placeholder={copy.composerPlaceholder}
          maxLength={COMMUNITY_POST_MAX_BODY}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onPaste={(e) => {
            if (!attachmentsEnabled) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                  e.preventDefault();
                  stageIncomingFile(file);
                  return;
                }
              }
            }
          }}
          onFocus={() => composerVisual.onFocus()}
          onBlur={() => composerVisual.onBlur()}
          onKeyDown={handleKeyDown}
        />

        <button type="submit" disabled={!canSubmit} aria-disabled={!canSubmit}>
          {sending ? copy.posting : copy.postAction}
        </button>
      </div>

      {sendError ? <p className="community-composer-error">{sendError}</p> : null}

      {attachmentsEnabled ? (
        <ComposerAttachMenu
          open={attachMenuOpen}
          onOpenChange={setAttachMenuOpen}
          anchorRef={attachBtnRef}
          disabled={sending}
          cameraDenied={attachmentStaging.cameraDenied}
          onCameraDeniedDismiss={() => attachmentStaging.clearCameraDenied()}
          onCameraPermissionDenied={() => {
            attachmentStaging.markCameraDenied();
            setAttachMenuOpen(true);
          }}
          onFileChosen={(file) => stageIncomingFile(file)}
          onQuickMessage={(text) => insertQuickMessage(text)}
          labels={{
            attach: sc.attach,
            attachMenuTitle: sc.attachMenuTitle,
            camera: sc.camera,
            photos: sc.photos,
            file: sc.file,
            quickMessage: sc.quickMessage,
            closeMenu: sc.closeAttachMenu,
            cameraDenied: sc.cameraDenied,
            chooseFromPhotos: sc.chooseFromPhotos,
            cancel: t.common.cancel,
            quickMessages: buildQuickMessageLabels(sc as unknown as Record<string, string>),
          }}
        />
      ) : null}
    </form>
  );

  return (
    <div
      className="community-composer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="community-composer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sendingLock.current) onClose();
      }}
    >
      <div className="community-composer community-composer-modal">
        <div className="community-composer-header">
          <h2 id="community-composer-title">{copy.composerTitle}</h2>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={sending}
            aria-label={copy.closeComposer}
          >
            {t.common.close}
          </button>
        </div>
        {attachmentsEnabled ? (
          <ChatDropOverlay
            enabled={!sending}
            label={copy.dropFilesHint}
            onFiles={(files) => {
              const file = files[0];
              if (file) stageIncomingFile(file);
            }}
          >
            {form}
          </ChatDropOverlay>
        ) : (
          form
        )}
      </div>
    </div>
  );
}
