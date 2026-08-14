import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { groupChatApi } from '../../lib/groupChatApi';
import {
  buildChatForwardDestinations,
  type ChatForwardDestination,
} from '../../lib/groupChatForward';
import { isGiphyConfigured, type GiphyMediaItem } from '../../lib/giphyClient';
import { validateGroupChatName } from '../../lib/groupChatValidation';
import {
  buildGroupChatMediaPayload,
  buildStoreChatMediaPayload,
  canSendGroupChatMedia,
  groupChatMediaLabel,
  hasGiphyMedia,
  type ChatAttachmentPayloadInput,
} from '../../lib/storeChatMediaPayload';
import { isChatAttachmentsEnabled } from '../../lib/chatAttachmentsFlag';
import { uploadChatAttachment } from '../../lib/chatAttachmentUpload';
import {
  chatAttachmentPolicyErrorCopy,
  formatChatAttachmentBytes,
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from '../../lib/chatAttachmentDisplay';
import {
  buildGroupMentionCandidates,
  buildMentionMenuItems,
  expandMentionRecipients,
  getActiveMentionQuery,
  insertMentionToken,
  MENTION_ALL_TOKEN,
  parseMentionedUserIdsJson,
  resolveMentionPayload,
  segmentMentionBody,
  type MentionCandidate,
  type MentionMenuItem,
  type SelectedMention,
} from '../../lib/storeChatMentions';
import { buildGroupChatMentionNotifications } from '../../lib/notifications';
import {
  QUICK_UNICODE_REACTIONS,
  giphyReactionDisplayUrl,
  resolveGiphyReactionToggle,
  resolveUnicodeReactionToggle,
  type GiphyReactionGroup,
  type UnicodeReactionGroup,
} from '../../lib/storeChatReactions';
import {
  isStoreChatTranslationEnabled,
  markTranslationRetry,
  probeStoreChatTranslationCapability,
  resolveTranslationTargetLang,
  runStoreChatTranslation,
  toggleShowingOriginal,
  translationDisplayText,
  type StoreChatTranslationState,
} from '../../lib/storeChatTranslation';
import { avatarFieldsForMessage } from '../../lib/storeChatAvatar';
import { nowIso } from '../../lib/utils';
import type {
  GroupChatInvite,
  GroupChatMember,
  GroupChatMessage,
  GroupChatRoom,
  Profile,
  Store,
} from '../../types';
import IdentityWithAvatar from '../profileAvatar/IdentityWithAvatar';
import ProfileAvatar from '../profileAvatar/ProfileAvatar';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import { AmbientGlowMedia } from './AmbientGlowMedia';
import ZoomableImage from '../media-interaction/ZoomableImage';
import FloatingAssistantLoader from './FloatingAssistantLoader';
import { GiphyMediaPreview } from './GiphyMediaPreview';
import { ChatAttachmentPreview } from './ChatAttachmentPreview';
import { ChatDropOverlay } from './ChatDropOverlay';
import {
  ComposerAttachMenu,
  buildQuickMessageLabels,
} from './ComposerAttachMenu';
import { useChatAttachmentStaging } from './useChatAttachmentStaging';
import './chatAttachments.css';
import {
  listStoreChatActions,
  resolveStoreChatActionKeyboard,
  type StoreChatActionCapabilityContext,
  type StoreChatActionId,
  type StoreChatActionLabelCopy,
} from './storeChatActions';
import { useGroupChatRoom } from './useGroupChatRoom';
import { useMessageLongPress } from './useMessageLongPress';
import { useSwipeToReply } from './useSwipeToReply';
import type { ComposerVisualHandlers } from './useComposerVisualState';
import './giphyPicker.css';

const GiphyPicker = lazy(() =>
  import('./GiphyPicker').then((m) => ({ default: m.GiphyPicker })),
);

export const GROUP_CHAT_MAX_BODY = 2000;

interface Props {
  roomId: string | null;
  profile: Profile;
  panelId: string;
  labelledBy: string;
  hidden: boolean;
  canSend: boolean;
  composerVisual: ComposerVisualHandlers;
  /** Authorized stores for invite picker overlap / cross-store gating / forward. */
  authorizedStores?: Store[];
  /** Other group rooms for forward destinations. */
  groupRooms?: GroupChatRoom[];
  canCrossStore?: boolean;
  initialTargetMessageId?: string;
  onInitialTargetHandled?: () => void;
  onBack?: () => void;
  showBack?: boolean;
}

type MemberProfileLike = NonNullable<GroupChatMember['profile']>;
type InviteeProfileLike = NonNullable<GroupChatInvite['invitee']>;

function memberProfile(m: {
  profile?: MemberProfileLike | MemberProfileLike[] | null;
}): MemberProfileLike | null {
  if (!m.profile) return null;
  return Array.isArray(m.profile) ? m.profile[0] ?? null : m.profile;
}

function inviteeProfile(inv: {
  invitee?: InviteeProfileLike | InviteeProfileLike[] | null;
}): InviteeProfileLike | null {
  if (!inv.invitee) return null;
  return Array.isArray(inv.invitee) ? inv.invitee[0] ?? null : inv.invitee;
}

function messageHasGiphy(message: GroupChatMessage): boolean {
  return hasGiphyMedia({
    giphyId: message.giphyId || '',
    giphyUrl: message.giphyUrl || '',
  });
}

function isDeleted(m: GroupChatMessage): boolean {
  return m.status === 'deleted' || Boolean(m.deletedAt);
}

function isForwarded(m: GroupChatMessage): boolean {
  return Boolean(m.forwardedFromMessageId?.trim());
}

function isSystemMessage(m: GroupChatMessage): boolean {
  return m.messageType === 'system';
}

function formatMessageTime(iso: string): string {
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

function quotePreviewText(
  message: GroupChatMessage,
  copy: { originalDeleted: string; emptyMessage: string },
): string {
  if (isDeleted(message)) return copy.originalDeleted;
  const compact = message.body.trim().replace(/\s+/g, ' ');
  if (compact) {
    return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
  }
  if (messageHasGiphy(message)) {
    return groupChatMediaLabel(String(message.messageType || 'giphy_media'), message.giphyKind);
  }
  if (messageHasChatAttachment(message)) {
    return groupChatMediaLabel(
      String(message.messageType || 'attachment'),
      undefined,
      message.attachmentKind,
    );
  }
  return copy.emptyMessage;
}

function actionLabelsFromT(sc: StoreChatActionLabelCopy): StoreChatActionLabelCopy {
  return {
    reply: sc.reply,
    react: sc.react,
    more: sc.more,
    copy: sc.copy,
    forward: sc.forward,
    favorite: sc.favorite,
    removeFavorite: sc.removeFavorite,
    translate: sc.translate,
    delete: sc.delete,
  };
}

function buildActionContext(params: {
  isOwn: boolean;
  deleted: boolean;
  canSend: boolean;
  canReact: boolean;
  body: string;
  translationAvailable: boolean;
  isBookmarked: boolean;
  canForward: boolean;
  isSystemMessage?: boolean;
}): StoreChatActionCapabilityContext {
  return {
    isOwn: params.isOwn,
    isDeleted: params.deleted,
    canSend: params.canSend,
    canReact: params.canReact,
    hasBody: params.body.trim().length > 0,
    translationAvailable: params.translationAvailable,
    isBookmarked: params.isBookmarked,
    canForward: params.canForward,
    isSystemMessage: Boolean(params.isSystemMessage),
  };
}

function MentionBody({
  body,
  mentionedUserIdsJson,
  mentionAll,
  candidates,
}: {
  body: string;
  mentionedUserIdsJson?: string;
  mentionAll?: boolean;
  candidates: MentionCandidate[];
}) {
  const mentionedIds = parseMentionedUserIdsJson(mentionedUserIdsJson);
  const segments = segmentMentionBody(body, mentionedIds, Boolean(mentionAll), candidates);
  return (
    <p className="fa-msg-body">
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <span key={`m-${i}`} className="fa-msg-mention">
            {seg.value}
          </span>
        ) : (
          <span key={`t-${i}`}>{seg.value}</span>
        ),
      )}
    </p>
  );
}

function GroupMessageRow({
  message,
  isOwn,
  profile,
  candidates,
  parentMessage,
  reactionGroups,
  giphyReactionGroups,
  canReact,
  canSend,
  canForward,
  giphyConfigured,
  translationAvailable,
  isBookmarked,
  trayOpen,
  whoReactedOpen,
  moreOpen,
  translation,
  glowEnabled,
  onAction,
  onJumpToParent,
  onToggleReaction,
  onToggleGiphyReaction,
  onOpenGiphyReactionPicker,
  onToggleWhoReacted,
  onToggleShowOriginal,
  onRetryTranslation,
  onRequestCloseMenus,
  highlighted,
}: {
  message: GroupChatMessage;
  isOwn: boolean;
  profile: Profile;
  candidates: MentionCandidate[];
  parentMessage: GroupChatMessage | null;
  reactionGroups: UnicodeReactionGroup[];
  giphyReactionGroups: GiphyReactionGroup[];
  canReact: boolean;
  canSend: boolean;
  canForward: boolean;
  giphyConfigured: boolean;
  translationAvailable: boolean;
  isBookmarked: boolean;
  trayOpen: boolean;
  whoReactedOpen: boolean;
  moreOpen: boolean;
  translation: StoreChatTranslationState | null;
  glowEnabled: boolean;
  onAction: (actionId: StoreChatActionId, messageId: string) => void;
  onJumpToParent: (messageId: string) => void;
  onToggleReaction: (messageId: string, unicode: string) => void;
  onToggleGiphyReaction: (messageId: string, giphyId: string) => void;
  onOpenGiphyReactionPicker: (messageId: string) => void;
  onToggleWhoReacted: (messageId: string) => void;
  onToggleShowOriginal: (messageId: string) => void;
  onRetryTranslation: (messageId: string) => void;
  onRequestCloseMenus: () => void;
  highlighted: boolean;
}) {
  const { t, isRtl } = useLang();
  const sc = t.storeChat;
  const labels = actionLabelsFromT(sc);
  const avatarProfile = avatarFieldsForMessage(message, isOwn, profile, candidates);
  const deleted = isDeleted(message);
  const isSystem = isSystemMessage(message);
  const rowClass = `fa-msg-row${isOwn ? ' fa-msg-row--own' : ''}${isSystem ? ' fa-msg-row--system' : ''}`;
  const actionCtx = buildActionContext({
    isOwn,
    deleted,
    canSend,
    canReact,
    body: message.body,
    translationAvailable,
    isBookmarked,
    canForward,
    isSystemMessage: isSystem,
  });
  const stripActions = listStoreChatActions('strip', actionCtx, labels);
  const moreActions = listStoreChatActions('moreMenu', actionCtx, labels);

  const swipe = useSwipeToReply({
    enabled: !deleted && canSend,
    isRtl,
    onReply: () => onAction('reply', message.id),
  });
  const longPress = useMessageLongPress({
    enabled: !deleted,
    onLongPress: () => onAction('more', message.id),
  });
  const labelByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) map.set(c.userId, c.label);
    if (message.senderUserId && message.senderNameSnapshot) {
      map.set(message.senderUserId, message.senderNameSnapshot);
    }
    map.set(profile.userId, sc.you);
    return map;
  }, [candidates, message.senderNameSnapshot, message.senderUserId, profile.userId, sc.you]);

  if (deleted) {
    if (!isOwn) return null;
    return (
      <div
        className={`${rowClass}${highlighted ? ' fa-msg-row--highlighted' : ''}`}
        data-msg-id={message.id}
      >
        <span className="fa-msg-avatar">
          <ProfileAvatarPreview profile={avatarProfile} size={28} previewEnabled />
        </span>
        <div className="fa-msg fa-msg--own fa-msg--deleted">
          <p className="fa-msg-deleted">{sc.messageDeleted}</p>
        </div>
      </div>
    );
  }

  const name = isOwn ? sc.you : message.senderNameSnapshot || sc.unknown;
  const hasUnicodeReactions = reactionGroups.length > 0;
  const hasGiphyReactions = giphyReactionGroups.length > 0;
  const hasReactions = hasUnicodeReactions || hasGiphyReactions;
  const messageHasMedia = messageHasGiphy(message);
  const mediaSrc = (message.giphyUrl || message.giphyPreviewUrl || '').trim();
  const hasAttachment = messageHasChatAttachment(message);
  const attachmentUrl = resolveChatAttachmentUrl(message);
  const attachmentKind = String(message.attachmentKind || '').trim();
  const attachmentLabel = groupChatMediaLabel(
    String(message.messageType || 'attachment'),
    undefined,
    attachmentKind,
  );
  const attachmentBytesLabel = formatChatAttachmentBytes(message.attachmentBytes);
  const bodyTrimmed = message.body.trim();
  const showingTranslated =
    translation?.status === 'success' &&
    Boolean(translation.translatedText) &&
    !translation.showingOriginal;
  const displayBody = translation ? translationDisplayText(translation) : message.body;
  const swipeCoach = canSend
    ? isRtl
      ? sc.swipeToReplyCoachRtl
      : sc.swipeToReplyCoach
    : undefined;

  return (
    <div
      className={`${rowClass}${highlighted ? ' fa-msg-row--highlighted' : ''}${isBookmarked ? ' fa-msg-row--bookmarked' : ''}`}
      data-msg-id={message.id}
      tabIndex={0}
      aria-description={swipeCoach}
      {...swipe}
      {...longPress}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Escape') {
          if (moreOpen || trayOpen) {
            event.preventDefault();
            onRequestCloseMenus();
          }
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('textarea, input, [contenteditable="true"]')) return;
        const actionId = resolveStoreChatActionKeyboard(event.key, actionCtx);
        if (!actionId) return;
        event.preventDefault();
        onAction(actionId, message.id);
      }}
    >
      {!isSystem ? (
        <span className="fa-msg-avatar">
          <ProfileAvatarPreview profile={avatarProfile} size={28} previewEnabled />
        </span>
      ) : null}
      <div className={`fa-msg${isOwn ? ' fa-msg--own' : ' fa-msg--other'}${isSystem ? ' fa-msg--system' : ''}`}>
        {isForwarded(message) && !isSystem ? (
          <span className="fa-msg-forwarded-badge">{sc.forwarded}</span>
        ) : null}
        {!isSystem && message.replyToMessageId ? (
          <button
            type="button"
            className="fa-msg-quote"
            onClick={() => {
              if (parentMessage) onJumpToParent(parentMessage.id);
            }}
            disabled={!parentMessage}
            title={parentMessage ? sc.jumpToOriginal : sc.originalUnavailable}
          >
            <span className="fa-msg-quote-label">
              {parentMessage
                ? sc.replyingTo.replace('{name}', parentMessage.senderNameSnapshot || sc.unknown)
                : sc.replyingToMissing}
            </span>
            <span className="fa-msg-quote-text">
              {parentMessage ? quotePreviewText(parentMessage, sc) : sc.originalUnavailable}
            </span>
          </button>
        ) : null}
        <div className="fa-msg-meta">
          <span className="fa-msg-name">{isSystem ? 'System' : name}</span>
          {isBookmarked ? (
            <span className="fa-msg-bookmark-mark" title={sc.favorited} aria-label={sc.favorited}>
              ★
            </span>
          ) : null}
          <time className="fa-msg-time" dateTime={message.createdAt}>
            {formatMessageTime(message.createdAt)}
          </time>
        </div>
        {!isSystem && messageHasMedia && mediaSrc ? (
          <div className="fa-msg-media" data-giphy-kind={message.giphyKind || undefined}>
            <AmbientGlowMedia cacheKey={mediaSrc} breathe enabled={glowEnabled}>
              <img
                className="fa-msg-giphy"
                src={mediaSrc}
                alt={message.giphyTitle || groupChatMediaLabel(String(message.messageType), message.giphyKind)}
                width={Number.parseInt(message.giphyWidth || '', 10) || undefined}
                height={Number.parseInt(message.giphyHeight || '', 10) || undefined}
                loading="lazy"
                decoding="async"
                crossOrigin="anonymous"
              />
            </AmbientGlowMedia>
            {message.giphyTitle ? (
              <span className="fa-msg-media-caption">{message.giphyTitle}</span>
            ) : null}
          </div>
        ) : null}
        {!isSystem && hasAttachment && attachmentKind === 'image' && attachmentUrl ? (
          <div className="fa-msg-media" data-attachment-kind="image">
            <AmbientGlowMedia cacheKey={attachmentUrl} breathe enabled={glowEnabled}>
              <ZoomableImage
                alt={message.attachmentFileName || attachmentLabel}
                ariaLabel={t.photoSheet.zoomImage.replace(
                  '{alt}',
                  message.attachmentFileName || attachmentLabel,
                )}
                resetKey={attachmentUrl}
                stopPointerDownPropagation={false}
              >
                <img
                  className="fa-msg-attachment-image"
                  src={attachmentUrl}
                  alt={message.attachmentFileName || attachmentLabel}
                  width={Number.parseInt(message.attachmentWidth || '', 10) || undefined}
                  height={Number.parseInt(message.attachmentHeight || '', 10) || undefined}
                  loading="lazy"
                  decoding="async"
                />
              </ZoomableImage>
            </AmbientGlowMedia>
            {message.attachmentFileName ? (
              <span className="fa-msg-media-caption">{message.attachmentFileName}</span>
            ) : null}
          </div>
        ) : null}
        {!isSystem && hasAttachment && attachmentKind === 'file' ? (
          <a
            className="fa-msg-attachment-file"
            href={attachmentUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            download={message.attachmentFileName || undefined}
          >
            <span className="fa-msg-attachment-file__name">
              {message.attachmentFileName || attachmentLabel}
            </span>
            <span className="fa-msg-attachment-file__meta">
              {[message.attachmentMimeType, attachmentBytesLabel].filter(Boolean).join(' · ')}
            </span>
          </a>
        ) : null}
        {isSystem ? (
          <p className="fa-group-msg-system fa-msg-body">{message.body}</p>
        ) : showingTranslated ? (
          <p className="fa-msg-body fa-msg-body--translated">{displayBody}</p>
        ) : bodyTrimmed ? (
          <MentionBody
            body={message.body}
            mentionedUserIdsJson={message.mentionedUserIdsJson}
            mentionAll={message.mentionAll}
            candidates={candidates}
          />
        ) : null}
        {!isSystem && translation && translation.status !== 'idle' && translation.status !== 'empty' ? (
          <div className="fa-msg-translation" role="status">
            {translation.status === 'loading' || translation.status === 'retry' ? (
              <span className="fa-msg-translation-status">{sc.translating}</span>
            ) : null}
            {translation.status === 'success' ? (
              <button
                type="button"
                className="fa-msg-translation-toggle"
                onClick={() => onToggleShowOriginal(message.id)}
              >
                {translation.showingOriginal ? sc.showTranslation : sc.showOriginal}
              </button>
            ) : null}
            {translation.status === 'failed' ? (
              <>
                <span className="fa-msg-translation-error">
                  {translation.errorMessage || sc.translationFailed}
                </span>
                <button
                  type="button"
                  className="fa-msg-translation-retry"
                  onClick={() => onRetryTranslation(message.id)}
                >
                  {t.common.retry}
                </button>
              </>
            ) : null}
            {translation.status === 'already-same-language' ? (
              <span className="fa-msg-translation-status">{sc.alreadyInYourLanguage}</span>
            ) : null}
            {translation.status === 'unsupported' ? (
              <span className="fa-msg-translation-status">
                {translation.errorMessage || sc.translationUnavailable}
              </span>
            ) : null}
          </div>
        ) : null}
        {hasReactions ? (
          <div className="fa-msg-reactions" role="group" aria-label={sc.reactions}>
            {reactionGroups.map((group) => {
              const who = group.userIds
                .map((uid) => labelByUserId.get(uid) || sc.someone)
                .join(', ');
              const actionHint = group.reactedByMe
                ? sc.activateRemoveReaction
                : sc.activateAddReaction;
              const countLabel = (
                group.count === 1 ? sc.reactionSingular : sc.reactionPlural
              ).replace('{count}', String(group.count));
              return (
                <button
                  key={group.unicode}
                  type="button"
                  className={`fa-reaction-chip${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                  aria-pressed={group.reactedByMe}
                  aria-label={`${group.unicode}, ${countLabel}. ${who}. ${canReact ? actionHint : ''}`}
                  disabled={!canReact}
                  onClick={() => onToggleReaction(message.id, group.unicode)}
                >
                  <span className="fa-reaction-chip-emoji" aria-hidden="true">
                    {group.unicode}
                  </span>
                  <span className="fa-reaction-chip-count">{group.count}</span>
                </button>
              );
            })}
            {giphyReactionGroups.map((group) => {
              const who = group.userIds
                .map((uid) => labelByUserId.get(uid) || sc.someone)
                .join(', ');
              const actionHint = group.reactedByMe
                ? sc.activateRemoveGifReaction
                : sc.activateAddGifReaction;
              const preview = giphyReactionDisplayUrl(group);
              const title = group.giphyTitle || sc.gifReaction;
              const countLabel = (
                group.count === 1 ? sc.reactionSingular : sc.reactionPlural
              ).replace('{count}', String(group.count));
              return (
                <button
                  key={`giphy-${group.giphyId}`}
                  type="button"
                  className={`fa-reaction-chip fa-reaction-chip--giphy${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                  aria-pressed={group.reactedByMe}
                  aria-label={`${title}, ${countLabel}. ${who}. ${canReact ? actionHint : ''}`}
                  disabled={!canReact}
                  onClick={() => onToggleGiphyReaction(message.id, group.giphyId)}
                >
                  {preview ? (
                    <AmbientGlowMedia
                      className="fa-reaction-chip-glow"
                      cacheKey={preview}
                      breathe={false}
                      enabled={glowEnabled}
                    >
                      <img
                        className="fa-reaction-chip-giphy"
                        src={preview}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        crossOrigin="anonymous"
                      />
                    </AmbientGlowMedia>
                  ) : (
                    <span className="fa-reaction-chip-emoji" aria-hidden="true">
                      {sc.gif}
                    </span>
                  )}
                  <span className="fa-reaction-chip-count">{group.count}</span>
                </button>
              );
            })}
            {hasReactions ? (
              <button
                type="button"
                className="fa-reaction-who"
                aria-expanded={whoReactedOpen}
                aria-controls={`fa-who-reacted-${message.id}`}
                onClick={() => onToggleWhoReacted(message.id)}
              >
                {sc.whoReacted}
              </button>
            ) : null}
          </div>
        ) : null}
        {whoReactedOpen && hasReactions ? (
          <div
            id={`fa-who-reacted-${message.id}`}
            className="fa-who-reacted"
            role="region"
            aria-label={sc.whoReacted}
          >
            {reactionGroups.map((group) => (
              <div key={`who-${group.unicode}`} className="fa-who-reacted-row">
                <span className="fa-who-reacted-emoji" aria-hidden="true">
                  {group.unicode}
                </span>
                <span className="fa-who-reacted-names">
                  {group.userIds.map((uid) => labelByUserId.get(uid) || sc.someone).join(', ')}
                </span>
              </div>
            ))}
            {giphyReactionGroups.map((group) => (
              <div key={`who-giphy-${group.giphyId}`} className="fa-who-reacted-row">
                <span className="fa-who-reacted-giphy" aria-hidden="true">
                  {giphyReactionDisplayUrl(group) ? (
                    <img
                      src={giphyReactionDisplayUrl(group)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    sc.gif
                  )}
                </span>
                <span className="fa-who-reacted-names">
                  {group.userIds.map((uid) => labelByUserId.get(uid) || sc.someone).join(', ')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {trayOpen ? (
          <div className="fa-reaction-tray" role="toolbar" aria-label={sc.quickReactions}>
            {QUICK_UNICODE_REACTIONS.map((emoji) => {
              const mine = reactionGroups.some((g) => g.unicode === emoji && g.reactedByMe);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`fa-reaction-tray-btn${mine ? ' fa-reaction-tray-btn--mine' : ''}`}
                  aria-label={(mine ? sc.removeReaction : sc.addReaction).replace('{emoji}', emoji)}
                  aria-pressed={mine}
                  disabled={!canReact}
                  onClick={() => onToggleReaction(message.id, emoji)}
                >
                  {emoji}
                </button>
              );
            })}
            {giphyConfigured ? (
              <button
                type="button"
                className="fa-reaction-tray-btn fa-reaction-tray-btn--giphy"
                aria-label={sc.searchGiphyReactions}
                disabled={!canReact}
                onClick={() => onOpenGiphyReactionPicker(message.id)}
              >
                {sc.gif}
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className="fa-msg-actions"
          role="toolbar"
          aria-label={sc.actionsFor.replace('{name}', name)}
        >
          {stripActions.map((action) => {
            if (action.id === 'react') {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="fa-msg-action-btn fa-msg-react-btn"
                  aria-expanded={trayOpen}
                  onClick={() => onAction('react', message.id)}
                  aria-label={
                    trayOpen ? sc.closeReactionTray : sc.reactTo.replace('{name}', name)
                  }
                >
                  <svg
                    className="fa-msg-action-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                  <span className="fa-msg-action-label">{action.label}</span>
                </button>
              );
            }
            if (action.id === 'reply') {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="fa-msg-action-btn fa-msg-reply-btn"
                  onClick={() => onAction('reply', message.id)}
                  aria-label={sc.replyTo.replace('{name}', name)}
                >
                  <svg
                    className="fa-msg-action-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                  </svg>
                  <span className="fa-msg-action-label">{action.label}</span>
                </button>
              );
            }
            if (action.id === 'more') {
              const moreLabel = sc.moreActionsFor.replace('{name}', name);
              return (
                <span key={action.id} className="fa-msg-more-wrap">
                  <button
                    type="button"
                    className="fa-msg-action-btn fa-msg-more-btn"
                    aria-expanded={moreOpen}
                    aria-haspopup="menu"
                    aria-controls={moreOpen ? `fa-msg-more-menu-${message.id}` : undefined}
                    onClick={() => onAction('more', message.id)}
                    aria-label={moreLabel}
                    title={moreLabel}
                  >
                    <svg
                      className="fa-msg-action-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="19" cy="12" r="2" />
                    </svg>
                  </button>
                  {moreOpen ? (
                    <div
                      id={`fa-msg-more-menu-${message.id}`}
                      className="fa-msg-more-menu"
                      role="menu"
                      aria-label={sc.moreMessageActions}
                    >
                      {moreActions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          className={`fa-msg-more-item${item.destructive ? ' fa-msg-more-item--danger' : ''}`}
                          onClick={() => onAction(item.id, message.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </span>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export default function GroupChatPanel({
  roomId,
  profile,
  panelId,
  labelledBy,
  hidden,
  canSend,
  composerVisual,
  authorizedStores = [],
  groupRooms = [],
  canCrossStore = false,
  initialTargetMessageId = '',
  onInitialTargetHandled,
  onBack,
  showBack = false,
}: Props) {
  const { lang, t } = useLang();
  const sc = t.storeChat;
  const actionLabels = actionLabelsFromT(sc);
  const {
    room,
    messages,
    members,
    pendingInvites,
    myMembership,
    reactionsByMessageId,
    reactionGroupsByMessageId,
    giphyReactionGroupsByMessageId,
    bookmarkByMessageId,
    isLoading,
  } = useGroupChatRoom(hidden ? null : roomId, profile.userId);

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [trackedMentions, setTrackedMentions] = useState<SelectedMention[]>([]);
  const [mentionAllTracked, setMentionAllTracked] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const [replyTargetMessageId, setReplyTargetMessageId] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const [selectedGiphy, setSelectedGiphy] = useState<GiphyMediaItem | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [giphyPickerOpen, setGiphyPickerOpen] = useState(false);
  const [giphyPickerMode, setGiphyPickerMode] = useState<'composer' | 'reaction'>('composer');
  const [giphyReactionTargetMessageId, setGiphyReactionTargetMessageId] = useState('');
  const [reactionTrayMessageId, setReactionTrayMessageId] = useState('');
  const [whoReactedMessageId, setWhoReactedMessageId] = useState('');
  const [moreMenuMessageId, setMoreMenuMessageId] = useState('');
  const [actionSheetMessageId, setActionSheetMessageId] = useState('');
  const [forwardPickerMessageId, setForwardPickerMessageId] = useState('');
  const [actionAnnounce, setActionAnnounce] = useState('');
  const [translationCapable, setTranslationCapable] = useState(false);
  const [translationsByMessageId, setTranslationsByMessageId] = useState<
    Record<string, StoreChatTranslationState>
  >({});

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaBtnRef = useRef<HTMLButtonElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const sendingLock = useRef(false);
  const highlightTimeoutRef = useRef<number | null>(null);
  const announceTimeoutRef = useRef<number | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const reactionToggleLock = useRef(new Set<string>());
  const bookmarkToggleLock = useRef(new Set<string>());
  const prevRoomId = useRef<string | null>(roomId);

  const giphyConfigured = isGiphyConfigured();
  const attachmentsEnabled = isChatAttachmentsEnabled();
  const attachmentStaging = useChatAttachmentStaging({
    onStageAttachment: () => setSelectedGiphy(null),
  });
  const roomRole = myMembership?.roomRole || '';
  const canManage = roomRole === 'owner' || roomRole === 'admin';
  const archived = room?.status === 'archived';
  const composerEnabled = canSend && !archived;
  const canReact = Boolean(roomId && profile.userId && !archived);

  const forwardDestinations = useMemo(
    () =>
      buildChatForwardDestinations({
        authorizedStores,
        groupRooms,
        excludeGroupRoomId: roomId,
      }),
    [authorizedStores, groupRooms, roomId],
  );
  const canForward = composerEnabled && forwardDestinations.length > 0;
  const translationAvailable = translationCapable && isStoreChatTranslationEnabled();

  function announce(message: string) {
    setActionAnnounce(message);
    if (announceTimeoutRef.current !== null) window.clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = window.setTimeout(() => {
      setActionAnnounce('');
      announceTimeoutRef.current = null;
    }, 2500);
  }

  function rememberFocusTarget(messageId: string) {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-msg-id="${messageId}"]`);
    focusReturnRef.current = node ?? (document.activeElement as HTMLElement | null);
  }

  function restoreFocus() {
    const target = focusReturnRef.current;
    focusReturnRef.current = null;
    requestAnimationFrame(() => {
      target?.focus?.();
    });
  }

  function closeTransientMenus() {
    const hadOverlay =
      Boolean(moreMenuMessageId) ||
      Boolean(actionSheetMessageId) ||
      Boolean(forwardPickerMessageId) ||
      Boolean(reactionTrayMessageId) ||
      giphyPickerOpen;
    setMoreMenuMessageId('');
    setActionSheetMessageId('');
    setForwardPickerMessageId('');
    setReactionTrayMessageId('');
    setGiphyPickerOpen(false);
    setGiphyReactionTargetMessageId('');
    if (hadOverlay) restoreFocus();
  }

  const mentionCandidates = useMemo(() => {
    return buildGroupMentionCandidates(
      members.map((m) => ({
        userId: m.userId,
        profile: memberProfile(m),
      })) as Parameters<typeof buildGroupMentionCandidates>[0],
      profile.userId,
    );
  }, [members, profile.userId]);

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const memberProfileIds = useMemo(
    () => new Set(members.map((m) => m.profileId).filter(Boolean)),
    [members],
  );
  const pendingInviteeProfileIds = useMemo(
    () => new Set(pendingInvites.map((inv) => inv.inviteeProfileId).filter(Boolean)),
    [pendingInvites],
  );

  const { data: pickerData } = db.useQuery(
    detailsOpen && canManage
      ? {
          profiles: {
            $: { where: { approvalStatus: 'approved' } },
            stores: {},
          },
        }
      : null,
  );

  const authorizedStoreIds = useMemo(
    () => new Set(authorizedStores.map((s) => s.id)),
    [authorizedStores],
  );

  const inviteCandidates = useMemo(() => {
    const profiles = (pickerData?.profiles ?? []) as Profile[];
    const needle = inviteSearch.trim().toLowerCase();
    return profiles
      .filter(
        (p) =>
          p.id !== profile.id &&
          p.userId !== profile.userId &&
          !memberUserIds.has(p.userId) &&
          !memberProfileIds.has(p.id) &&
          !pendingInviteeProfileIds.has(p.id),
      )
      .map((p) => {
        const storeIds = (p.stores ?? []).map((s) => s.id);
        const overlap = storeIds.some((sid) => authorizedStoreIds.has(sid));
        const cross = !overlap;
        const disabled = cross && !canCrossStore;
        const reason = disabled
          ? 'Outside your stores (needs cross-store capability)'
          : cross
            ? 'Cross-store'
            : '';
        const label = p.displayName || p.email || p.id;
        const hay = `${label} ${p.role} ${storeIds.join(' ')}`.toLowerCase();
        const matches = !needle || hay.includes(needle);
        return { profile: p, label, disabled, reason, matches };
      })
      .filter((c) => c.matches)
      .slice(0, 80);
  }, [
    pickerData?.profiles,
    profile.id,
    profile.userId,
    memberUserIds,
    memberProfileIds,
    pendingInviteeProfileIds,
    authorizedStoreIds,
    canCrossStore,
    inviteSearch,
  ]);

  const profileLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of (pickerData?.profiles ?? []) as Profile[]) {
      map.set(p.id, p.displayName || p.email || p.id);
    }
    return map;
  }, [pickerData?.profiles]);

  const messageById = useMemo(() => {
    const map = new Map<string, GroupChatMessage>();
    for (const message of messages) map.set(message.id, message);
    return map;
  }, [messages]);

  const activeMention = useMemo(
    () => (mentionOpen ? getActiveMentionQuery(draft, caret) : null),
    [mentionOpen, draft, caret],
  );

  const menuItems = useMemo(() => {
    if (!activeMention) return [] as MentionMenuItem[];
    return buildMentionMenuItems(mentionCandidates, activeMention.query);
  }, [activeMention, mentionCandidates]);

  const showMentionMenu = Boolean(
    composerEnabled && mentionOpen && activeMention && menuItems.length > 0,
  );

  const replyTarget = replyTargetMessageId
    ? messageById.get(replyTargetMessageId) || null
    : null;

  const sheetMessage = actionSheetMessageId
    ? messageById.get(actionSheetMessageId) || null
    : null;
  const sheetActions = sheetMessage
    ? listStoreChatActions(
        'sheet',
        buildActionContext({
          isOwn: sheetMessage.senderUserId === profile.userId,
          deleted: isDeleted(sheetMessage),
          canSend: composerEnabled,
          canReact,
          body: sheetMessage.body,
          translationAvailable,
          isBookmarked: bookmarkByMessageId.has(sheetMessage.id),
          canForward,
          isSystemMessage: isSystemMessage(sheetMessage),
        }),
        actionLabels,
      )
    : [];

  const visibleMessages = messages.filter(
    (m) => !isDeleted(m) || m.senderUserId === profile.userId,
  );

  const trimmed = draft.trim();
  const canSubmit =
    composerEnabled &&
    Boolean(roomId) &&
    (canSendGroupChatMedia(draft, selectedGiphy) || attachmentStaging.hasStaged) &&
    !sending &&
    !sendingLock.current;

  function policyErrorMessage(code?: string) {
    return chatAttachmentPolicyErrorCopy(code, sc);
  }

  function stageIncomingFile(file: File) {
    void attachmentStaging.stageFile(file).then((result) => {
      if (!result.ok) {
        setSendError(policyErrorMessage(result.error.code));
        return;
      }
      setSendError(null);
      setAttachMenuOpen(false);
    });
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
    updateDraft(next.slice(0, GROUP_CHAT_MAX_BODY));
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caretPos = Math.min(start + text.length + 1, ta.value.length);
      ta.focus();
      ta.setSelectionRange(caretPos, caretPos);
      setCaret(caretPos);
    });
  }

  const ownerCount = useMemo(
    () => members.filter((m) => m.roomRole === 'owner').length,
    [members],
  );

  // Reset composer state when switching rooms.
  useEffect(() => {
    if (prevRoomId.current !== roomId) {
      prevRoomId.current = roomId;
      setDraft('');
      setSendError(null);
      setTrackedMentions([]);
      setMentionAllTracked(false);
      setMentionOpen(false);
      setMentionIndex(0);
      setReplyTargetMessageId('');
      setHighlightedMessageId('');
      setSelectedGiphy(null);
      setAttachMenuOpen(false);
      attachmentStaging.clear();
      attachmentStaging.clearCameraDenied();
      setGiphyPickerOpen(false);
      setGiphyPickerMode('composer');
      setGiphyReactionTargetMessageId('');
      setReactionTrayMessageId('');
      setWhoReactedMessageId('');
      setMoreMenuMessageId('');
      setActionSheetMessageId('');
      setForwardPickerMessageId('');
      setTranslationsByMessageId({});
      setDetailsOpen(false);
      setAddMembersOpen(false);
      setManageError(null);
      setRenaming(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (detailsOpen && room?.name) setRenameValue(room.name);
  }, [detailsOpen, room?.name]);

  useEffect(() => {
    if (hidden || !roomId) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, roomId, hidden]);

  useEffect(() => {
    if (mentionIndex >= menuItems.length) {
      setMentionIndex(Math.max(0, menuItems.length - 1));
    }
  }, [menuItems.length, mentionIndex]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (announceTimeoutRef.current !== null) {
        window.clearTimeout(announceTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isStoreChatTranslationEnabled()) {
      setTranslationCapable(false);
      return;
    }
    let cancelled = false;
    void probeStoreChatTranslationCapability().then((result) => {
      if (!cancelled) setTranslationCapable(result.status === 'ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !actionSheetMessageId &&
      !forwardPickerMessageId &&
      !moreMenuMessageId &&
      !reactionTrayMessageId
    ) {
      return;
    }
    function onDocKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTransientMenus();
      }
    }
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeTransientMenus closes current overlays
  }, [actionSheetMessageId, forwardPickerMessageId, moreMenuMessageId, reactionTrayMessageId]);

  useEffect(() => {
    if (!reactionTrayMessageId) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!(target instanceof Element)) {
        setReactionTrayMessageId('');
        return;
      }
      if (target.closest('.fa-reaction-tray') || target.closest('.fa-msg-react-btn')) return;
      setReactionTrayMessageId('');
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [reactionTrayMessageId]);

  function scrollToMessage(messageId: string) {
    if (!messageId || !listRef.current) return false;
    const node = listRef.current.querySelector<HTMLElement>(`[data-msg-id="${messageId}"]`);
    if (!node) return false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === messageId ? '' : prev));
      highlightTimeoutRef.current = null;
    }, 1700);
    return true;
  }

  useEffect(() => {
    if (!initialTargetMessageId || hidden || !roomId) return;
    if (scrollToMessage(initialTargetMessageId)) {
      onInitialTargetHandled?.();
    }
  }, [hidden, initialTargetMessageId, onInitialTargetHandled, roomId, messages.length]);

  function startReply(messageId: string) {
    if (!messageById.has(messageId) || !composerEnabled) return;
    setReplyTargetMessageId(messageId);
    setReactionTrayMessageId('');
    setMoreMenuMessageId('');
    setActionSheetMessageId('');
    textareaRef.current?.focus();
  }

  function toggleReactionTray(messageId: string) {
    setReactionTrayMessageId((prev) => (prev === messageId ? '' : messageId));
    setWhoReactedMessageId('');
    setMoreMenuMessageId('');
  }

  function toggleWhoReacted(messageId: string) {
    setWhoReactedMessageId((prev) => (prev === messageId ? '' : messageId));
  }

  async function toggleUnicodeReaction(messageId: string, unicode: string) {
    if (!roomId || !profile.userId) return;
    const existing = reactionsByMessageId.get(messageId) ?? [];
    let decision;
    try {
      decision = resolveUnicodeReactionToggle(existing, {
        messageId,
        userId: profile.userId,
        unicode,
      });
    } catch {
      return;
    }

    if (reactionToggleLock.current.has(decision.identityKey)) return;
    reactionToggleLock.current.add(decision.identityKey);

    try {
      if (decision.action === 'add') {
        const reactionId = id();
        await db.transact(
          db.tx.groupChatReactions[reactionId]
            .update({
              roomId,
              messageId: decision.payload.messageId,
              userId: decision.payload.userId,
              reactionType: decision.payload.reactionType,
              unicode: decision.payload.unicode,
              giphyId: decision.payload.giphyId,
              giphyKind: decision.payload.giphyKind,
              giphyTitle: decision.payload.giphyTitle,
              giphyUrl: decision.payload.giphyUrl,
              giphyPreviewUrl: decision.payload.giphyPreviewUrl,
              createdAt: nowIso(),
              clientMutationId: decision.clientMutationId,
            })
            .link({ room: roomId, message: messageId }),
        );
      } else {
        await db.transact(db.tx.groupChatReactions[decision.reactionId].delete());
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not update reaction. Try again.';
      setSendError(message);
    } finally {
      reactionToggleLock.current.delete(decision.identityKey);
    }
  }

  async function toggleGiphyReaction(
    messageId: string,
    giphyId: string,
    item?: GiphyMediaItem | null,
  ) {
    if (!roomId || !profile.userId) return;
    const existing = reactionsByMessageId.get(messageId) ?? [];
    let decision;
    try {
      decision = resolveGiphyReactionToggle(existing, {
        messageId,
        userId: profile.userId,
        giphyId,
        item,
      });
    } catch {
      return;
    }

    if (reactionToggleLock.current.has(decision.identityKey)) return;
    reactionToggleLock.current.add(decision.identityKey);

    try {
      if (decision.action === 'add') {
        const reactionId = id();
        await db.transact(
          db.tx.groupChatReactions[reactionId]
            .update({
              roomId,
              messageId: decision.payload.messageId,
              userId: decision.payload.userId,
              reactionType: decision.payload.reactionType,
              unicode: decision.payload.unicode,
              giphyId: decision.payload.giphyId,
              giphyKind: decision.payload.giphyKind,
              giphyTitle: decision.payload.giphyTitle,
              giphyUrl: decision.payload.giphyUrl,
              giphyPreviewUrl: decision.payload.giphyPreviewUrl,
              createdAt: nowIso(),
              clientMutationId: decision.clientMutationId,
            })
            .link({ room: roomId, message: messageId }),
        );
      } else {
        await db.transact(db.tx.groupChatReactions[decision.reactionId].delete());
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not update GIF reaction. Try again.';
      setSendError(message);
    } finally {
      reactionToggleLock.current.delete(decision.identityKey);
    }
  }

  function openComposerGiphyPicker() {
    if (!giphyConfigured || !composerEnabled) return;
    setGiphyPickerMode('composer');
    setGiphyReactionTargetMessageId('');
    setGiphyPickerOpen(true);
    setAttachMenuOpen(false);
    setReactionTrayMessageId('');
    setMoreMenuMessageId('');
  }

  function openGiphyReactionPicker(messageId: string) {
    if (!giphyConfigured || !canReact) return;
    rememberFocusTarget(messageId);
    setGiphyPickerMode('reaction');
    setGiphyReactionTargetMessageId(messageId);
    setGiphyPickerOpen(true);
    setReactionTrayMessageId('');
  }

  function handleGiphyPickerSelect(item: GiphyMediaItem) {
    if (giphyPickerMode === 'reaction' && giphyReactionTargetMessageId) {
      const targetId = giphyReactionTargetMessageId;
      setGiphyPickerOpen(false);
      setGiphyReactionTargetMessageId('');
      void toggleGiphyReaction(targetId, item.id, item);
      restoreFocus();
      return;
    }
    setSelectedGiphy(item);
    attachmentStaging.clear();
    setGiphyPickerOpen(false);
    textareaRef.current?.focus();
  }

  async function copyMessage(message: GroupChatMessage) {
    const text = message.body;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      announce(sc.messageCopied);
    } catch {
      announce(sc.copyFailed);
    }
  }

  async function toggleBookmark(messageId: string) {
    if (!roomId || !profile.userId) return;
    if (bookmarkToggleLock.current.has(messageId)) return;
    bookmarkToggleLock.current.add(messageId);
    const existing = bookmarkByMessageId.get(messageId);
    try {
      if (existing) {
        await db.transact(db.tx.groupChatBookmarks[existing.id].delete());
        announce(sc.removedFromFavorites);
      } else {
        const bookmarkId = id();
        await db.transact(
          db.tx.groupChatBookmarks[bookmarkId]
            .update({
              roomId,
              messageId,
              userId: profile.userId,
              createdAt: nowIso(),
            })
            .link({ room: roomId, message: messageId }),
        );
        announce(sc.addedToFavorites);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not update favorite. Try again.';
      setSendError(message);
    } finally {
      bookmarkToggleLock.current.delete(messageId);
    }
  }

  async function softDeleteMessage(message: GroupChatMessage) {
    if (isSystemMessage(message)) return;
    if (message.senderUserId !== profile.userId) return;
    try {
      await db.transact(
        db.tx.groupChatMessages[message.id].update({
          status: 'deleted',
          deletedAt: nowIso(),
        }),
      );
      announce(sc.messageDeletedAnnounce);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete message. Try again.';
      setSendError(msg);
    }
  }

  async function forwardMessage(message: GroupChatMessage, destination: ChatForwardDestination) {
    if (!composerEnabled || !profile.userId) return;
    if (!forwardDestinations.some((d) => d.kind === destination.kind && d.id === destination.id)) {
      setSendError('You cannot forward to that destination.');
      return;
    }
    const body = message.body.trim().slice(0, GROUP_CHAT_MAX_BODY);
    const hasMedia = messageHasGiphy(message);
    const hasAttachment = messageHasChatAttachment(message);
    if (!body && !hasMedia && !hasAttachment) return;
    const attachment: ChatAttachmentPayloadInput | null = hasAttachment
      ? {
          kind: String(message.attachmentKind || '').trim() === 'file' ? 'file' : 'image',
          path: message.attachmentPath || '',
          fileId: message.attachmentFileId || message.attachmentFile?.id || '',
          url: resolveChatAttachmentUrl(message),
          mimeType: message.attachmentMimeType || '',
          fileName: message.attachmentFileName || '',
          bytes: Number.parseInt(message.attachmentBytes || '', 10) || 0,
          width: Number.parseInt(message.attachmentWidth || '', 10) || null,
          height: Number.parseInt(message.attachmentHeight || '', 10) || null,
        }
      : null;
    const giphy =
      hasMedia && !attachment
        ? {
            id: message.giphyId || '',
            kind: (message.giphyKind as GiphyMediaItem['kind']) || 'gif',
            title: message.giphyTitle || '',
            width: Number.parseInt(message.giphyWidth || '', 10) || 0,
            height: Number.parseInt(message.giphyHeight || '', 10) || 0,
            url: message.giphyUrl || '',
            previewUrl: message.giphyPreviewUrl || message.giphyUrl || '',
            username: '',
            itemUrl: '',
          }
        : null;
    const msgId = id();
    const createdAt = nowIso();
    try {
      if (destination.kind === 'store') {
        const mediaPayload = buildStoreChatMediaPayload({
          body,
          giphy,
          attachment,
          clientMutationId: id(),
          forwardedFromMessageId: message.id,
          forwardedFromUserId: message.senderUserId,
        });
        const linkAttrs: Record<string, string> = {
          store: destination.id,
          sender: profile.id,
        };
        if (attachment?.fileId) linkAttrs.attachmentFile = attachment.fileId;
        await db.transact(
          db.tx.storeChatMessages[msgId]
            .update({
              storeId: destination.id,
              senderUserId: profile.userId,
              senderProfileId: profile.id,
              senderNameSnapshot: profile.displayName || profile.email || 'You',
              senderRoleSnapshot: profile.role || '',
              createdAt,
              editedAt: '',
              deletedAt: '',
              status: 'active',
              ...mediaPayload,
            })
            .link(linkAttrs),
        );
      } else {
        const mediaPayload = buildGroupChatMediaPayload({
          body,
          giphy,
          attachment,
          clientMutationId: id(),
          forwardedFromMessageId: message.id,
          forwardedFromUserId: message.senderUserId,
        });
        const linkAttrs: Record<string, string> = {
          room: destination.id,
          sender: profile.id,
        };
        if (attachment?.fileId) linkAttrs.attachmentFile = attachment.fileId;
        await db.transact([
          db.tx.groupChatMessages[msgId]
            .update({
              roomId: destination.id,
              senderUserId: profile.userId,
              senderProfileId: profile.id,
              senderNameSnapshot: profile.displayName || profile.email || 'You',
              senderRoleSnapshot: profile.role || '',
              createdAt,
              editedAt: '',
              deletedAt: '',
              status: 'active',
              ...mediaPayload,
            })
            .link(linkAttrs),
          db.tx.groupChatRooms[destination.id].update({
            lastMessageAt: createdAt,
            updatedAt: createdAt,
          }),
        ]);
      }
      announce(sc.forwardedTo.replace('{store}', destination.label));
      setForwardPickerMessageId('');
      restoreFocus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not forward message. Try again.';
      setSendError(msg);
    }
  }

  async function translateMessage(message: GroupChatMessage) {
    if (!translationAvailable) return;
    const targetLang = resolveTranslationTargetLang(lang);
    await runStoreChatTranslation(
      {
        text: message.body,
        targetLang,
        enabled: true,
      },
      (state) => {
        setTranslationsByMessageId((prev) => ({ ...prev, [message.id]: state }));
      },
    );
  }

  function toggleShowOriginal(messageId: string) {
    setTranslationsByMessageId((prev) => {
      const current = prev[messageId];
      if (!current) return prev;
      return { ...prev, [messageId]: toggleShowingOriginal(current) };
    });
  }

  async function retryTranslation(messageId: string) {
    const message = messageById.get(messageId);
    if (!message) return;
    setTranslationsByMessageId((prev) => {
      const current = prev[messageId];
      if (!current) return prev;
      return { ...prev, [messageId]: markTranslationRetry(current) };
    });
    await translateMessage(message);
  }

  function openActionSheet(messageId: string) {
    rememberFocusTarget(messageId);
    setActionSheetMessageId(messageId);
    setMoreMenuMessageId('');
    setReactionTrayMessageId('');
    setForwardPickerMessageId('');
  }

  function toggleMoreMenu(messageId: string) {
    const isTouch =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(hover: none), (pointer: coarse)').matches;
    if (isTouch) {
      openActionSheet(messageId);
      return;
    }
    rememberFocusTarget(messageId);
    setMoreMenuMessageId((prev) => (prev === messageId ? '' : messageId));
    setActionSheetMessageId('');
    setReactionTrayMessageId('');
  }

  function handleMessageAction(actionId: StoreChatActionId, messageId: string) {
    const message = messageById.get(messageId);
    if (!message || isDeleted(message)) return;

    if (actionId === 'reply') {
      closeTransientMenus();
      startReply(messageId);
      return;
    }
    if (actionId === 'react') {
      setMoreMenuMessageId('');
      setActionSheetMessageId('');
      toggleReactionTray(messageId);
      return;
    }
    if (actionId === 'more') {
      toggleMoreMenu(messageId);
      return;
    }
    if (actionId === 'copy') {
      closeTransientMenus();
      void copyMessage(message);
      return;
    }
    if (actionId === 'favorite') {
      closeTransientMenus();
      void toggleBookmark(messageId);
      return;
    }
    if (actionId === 'forward') {
      rememberFocusTarget(messageId);
      setForwardPickerMessageId(messageId);
      setMoreMenuMessageId('');
      setActionSheetMessageId('');
      return;
    }
    if (actionId === 'translate') {
      closeTransientMenus();
      void translateMessage(message);
      return;
    }
    if (actionId === 'delete') {
      closeTransientMenus();
      void softDeleteMessage(message);
    }
  }

  function syncCaretFromTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    setCaret(el.selectionStart ?? 0);
  }

  function refreshMentionState(nextDraft: string, nextCaret: number) {
    const active = getActiveMentionQuery(nextDraft, nextCaret);
    if (active && composerEnabled) {
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
    setCaret(nextCaret);
  }

  function applyMentionItem(item: MentionMenuItem) {
    const el = textareaRef.current;
    const currentCaret = el?.selectionStart ?? caret;
    const label = item.kind === 'all' ? MENTION_ALL_TOKEN : item.candidate.label;
    const result = insertMentionToken(draft, currentCaret, label);
    if (!result) return;

    setDraft(result.text);
    setSendError(null);
    if (!hidden) composerVisual.onInput();

    if (item.kind === 'all') {
      setMentionAllTracked(true);
    } else {
      setTrackedMentions((prev) => {
        if (prev.some((m) => m.userId === item.candidate.userId)) return prev;
        return [...prev, { userId: item.candidate.userId, label: item.candidate.label }];
      });
    }

    setMentionOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(result.caret, result.caret);
      setCaret(result.caret);
    });
  }

  function updateDraft(value: string) {
    setDraft(value);
    setSendError(null);
    if (!hidden) composerVisual.onInput();
    const el = textareaRef.current;
    const nextCaret = el?.selectionStart ?? value.length;
    refreshMentionState(value, nextCaret);
  }

  async function sendMessage(e?: FormEvent) {
    e?.preventDefault();
    if (hidden || !composerEnabled || !roomId || !room) return;
    if (!canSendGroupChatMedia(draft, selectedGiphy) && !attachmentStaging.hasStaged) return;
    if (sendingLock.current) return;

    sendingLock.current = true;
    setSending(true);
    setSendError(null);
    composerVisual.setSending();

    const body = trimmed.slice(0, GROUP_CHAT_MAX_BODY);
    const createdAt = nowIso();
    const resolved = resolveMentionPayload(
      body,
      trackedMentions,
      mentionAllTracked,
      mentionCandidates,
    );
    const recipientIds = expandMentionRecipients(
      resolved.mentionedUserIds,
      resolved.mentionAll,
      mentionCandidates,
      profile.userId,
    );

    let attachmentPayload: ChatAttachmentPayloadInput | null = null;
    const staged = attachmentStaging.staged;
    let msgId = id();
    let clientMutationId = id();
    if (staged && attachmentsEnabled) {
      const ids = attachmentStaging.ensureSendIds(() => id());
      msgId = ids.messageId;
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
          // Group rooms are not store-scoped — do not require authorizedStores.
          const uploaded = await uploadChatAttachment({
            blob: staged.blob,
            mimeType: staged.mimeType,
            fileName: staged.fileName,
            scope: 'group',
            roomId,
            messageId: msgId,
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

    const mediaPayload = buildGroupChatMediaPayload({
      body,
      giphy: attachmentPayload ? null : selectedGiphy,
      attachment: attachmentPayload,
      replyToMessageId: replyTargetMessageId || '',
      mentionedUserIds: resolved.mentionedUserIds,
      mentionAll: resolved.mentionAll,
      forwardedFromMessageId: '',
      forwardedFromUserId: '',
      clientMutationId,
    });

    const notifBody =
      body ||
      (attachmentPayload
        ? groupChatMediaLabel(
            mediaPayload.messageType,
            undefined,
            attachmentPayload.kind,
          )
        : selectedGiphy
          ? groupChatMediaLabel(mediaPayload.messageType, selectedGiphy.kind)
          : '');
    const notifTxs =
      recipientIds.length > 0
        ? buildGroupChatMentionNotifications({
            messageId: msgId,
            roomId,
            roomName: room.name || roomId,
            body: notifBody,
            actor: profile,
            recipientUserIds: recipientIds,
            mentionAll: resolved.mentionAll,
          })
        : [];

    const linkAttrs: Record<string, string> = {
      room: roomId,
      sender: profile.id,
    };
    if (attachmentPayload?.fileId) {
      linkAttrs.attachmentFile = attachmentPayload.fileId;
    }

    try {
      await db.transact([
        db.tx.groupChatMessages[msgId]
          .update({
            roomId,
            senderUserId: profile.userId,
            senderProfileId: profile.id,
            senderNameSnapshot: profile.displayName || profile.email || 'You',
            senderRoleSnapshot: profile.role || '',
            createdAt,
            editedAt: '',
            deletedAt: '',
            status: 'active',
            ...mediaPayload,
          })
          .link(linkAttrs),
        db.tx.groupChatRooms[roomId].update({
          lastMessageAt: createdAt,
          updatedAt: createdAt,
        }),
        ...notifTxs,
      ]);
      setDraft('');
      setTrackedMentions([]);
      setMentionAllTracked(false);
      setMentionOpen(false);
      setReplyTargetMessageId('');
      setSelectedGiphy(null);
      attachmentStaging.clear();
      composerVisual.setSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Send failed';
      setSendError(message);
      if (attachmentPayload) attachmentStaging.markFailed(message);
      composerVisual.setFailure();
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showMentionMenu && menuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % menuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = menuItems[mentionIndex];
        if (item) applyMentionItem(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
      return;
    }

    if (e.key === 'Escape' && replyTargetMessageId) {
      e.preventDefault();
      setReplyTargetMessageId('');
    }
  }

  async function leaveOrArchive() {
    if (!roomId || !myMembership) return;
    setBusy(true);
    setManageError(null);
    try {
      if (myMembership.roomRole === 'owner') {
        await groupChatApi('groupChatArchive', { roomId });
      } else {
        await groupChatApi('groupChatLeave', { roomId });
      }
      setDetailsOpen(false);
      onBack?.();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    if (!roomId || !canManage) return;
    const check = validateGroupChatName(renameValue);
    if (!check.ok) {
      setManageError(`Invalid name (${check.error})`);
      return;
    }
    setBusy(true);
    setManageError(null);
    try {
      await groupChatApi('groupChatRename', { roomId, name: check.name });
      setRenaming(false);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function inviteSelectedMembers() {
    if (!roomId || !canManage || !selectedInviteIds.length) return;
    setBusy(true);
    setManageError(null);
    try {
      await groupChatApi('groupChatInvite', {
        roomId,
        inviteeProfileIds: selectedInviteIds,
      });
      setSelectedInviteIds([]);
      setAddMembersOpen(false);
      setInviteSearch('');
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPendingInvite(inviteId: string) {
    setBusy(true);
    setManageError(null);
    try {
      await groupChatApi('groupChatCancel', { inviteId });
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  async function remindPendingInvite(inviteId: string) {
    setBusy(true);
    setManageError(null);
    try {
      await groupChatApi('groupChatRemind', { inviteId });
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Remind failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberUserId: string) {
    if (!roomId || !canManage) return;
    if (memberUserId === profile.userId) {
      setManageError('You cannot remove yourself here — use Leave.');
      return;
    }
    const target = members.find((m) => m.userId === memberUserId);
    if (!target) return;
    if (target.roomRole === 'owner' && ownerCount <= 1) {
      setManageError('Cannot remove the last owner.');
      return;
    }
    setBusy(true);
    setManageError(null);
    try {
      // Handler expects targetUserId (not memberUserId).
      await groupChatApi('groupChatRemoveMember', {
        roomId,
        targetUserId: memberUserId,
      });
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleInviteId(pid: string, disabled: boolean) {
    if (disabled) return;
    setSelectedInviteIds((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid],
    );
  }

  function closeDetails() {
    setDetailsOpen(false);
    setAddMembersOpen(false);
    setSelectedInviteIds([]);
    setInviteSearch('');
    setRenaming(false);
    setManageError(null);
  }

  if (hidden) {
    return (
      <section
        id={panelId}
        role="tabpanel"
        aria-labelledby={labelledBy}
        hidden
        className="fa-group-chat-panel"
      />
    );
  }

  const placeholder = !canSend
    ? 'View only — you cannot send in this group'
    : archived
      ? 'This group is archived'
      : room?.name
        ? `Message ${room.name}… (@ to mention)`
        : 'Message the group… (@ to mention)';

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="fa-group-chat-panel"
      data-room-id={roomId || undefined}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {actionAnnounce}
      </div>
      <header className="fa-group-chat-header">
        {showBack ? (
          <button type="button" className="fa-chats-back" onClick={onBack} aria-label="Back to chats">
            ←
          </button>
        ) : null}
        <div className="fa-group-chat-header-text">
          <h3 className="fa-group-chat-title">{room?.name || 'Group'}</h3>
          <p className="small">{members.length} members · private</p>
        </div>
        <button
          type="button"
          className="fa-panel-action"
          aria-label="Group details"
          onClick={() => setDetailsOpen(true)}
        >
          ℹ
        </button>
      </header>

      {isLoading && !room ? (
        <FloatingAssistantLoader label="Loading group…" />
      ) : (
        <ChatDropOverlay
          enabled={attachmentsEnabled && composerEnabled && !hidden && !sending}
          label={sc.dropFilesHint}
          onFiles={(files) => {
            const file = files[0];
            if (file) stageIncomingFile(file);
          }}
          className="fa-group-chat-drop"
        >
          <div className="fa-group-chat-messages fa-msg-list" ref={listRef} role="log" aria-live="polite">
            {visibleMessages.map((m) => (
              <GroupMessageRow
                key={m.id}
                message={m}
                isOwn={m.senderUserId === profile.userId}
                profile={profile}
                candidates={mentionCandidates}
                parentMessage={m.replyToMessageId ? messageById.get(m.replyToMessageId) || null : null}
                reactionGroups={reactionGroupsByMessageId.get(m.id) ?? []}
                giphyReactionGroups={giphyReactionGroupsByMessageId.get(m.id) ?? []}
                canReact={canReact}
                canSend={composerEnabled}
                canForward={canForward}
                giphyConfigured={giphyConfigured}
                translationAvailable={translationAvailable}
                isBookmarked={bookmarkByMessageId.has(m.id)}
                trayOpen={reactionTrayMessageId === m.id}
                whoReactedOpen={whoReactedMessageId === m.id}
                moreOpen={moreMenuMessageId === m.id}
                translation={translationsByMessageId[m.id] ?? null}
                glowEnabled={!hidden}
                onAction={handleMessageAction}
                onJumpToParent={scrollToMessage}
                onToggleReaction={(messageId, unicode) => {
                  setReactionTrayMessageId('');
                  void toggleUnicodeReaction(messageId, unicode);
                }}
                onToggleGiphyReaction={(messageId, giphyId) => {
                  void toggleGiphyReaction(messageId, giphyId);
                }}
                onOpenGiphyReactionPicker={openGiphyReactionPicker}
                onToggleWhoReacted={toggleWhoReacted}
                onToggleShowOriginal={toggleShowOriginal}
                onRetryTranslation={(messageId) => {
                  void retryTranslation(messageId);
                }}
                onRequestCloseMenus={closeTransientMenus}
                highlighted={highlightedMessageId === m.id}
              />
            ))}
            {!visibleMessages.length ? (
              <p className="fa-chats-list-empty">No messages yet. Say hello.</p>
            ) : null}
          </div>
        </ChatDropOverlay>
      )}

      {actionSheetMessageId && sheetMessage ? (
        <div className="fa-msg-sheet-backdrop" role="presentation" onClick={closeTransientMenus}>
          <div
            className="fa-msg-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sc.messageActions}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeTransientMenus();
              }
            }}
          >
            <div className="fa-msg-sheet-handle" aria-hidden="true" />
            <p className="fa-msg-sheet-preview">{quotePreviewText(sheetMessage, sc)}</p>
            <ul className="fa-msg-sheet-list">
              {sheetActions.map((action) => (
                <li key={action.id}>
                  <button
                    type="button"
                    className={`fa-msg-sheet-item${action.destructive ? ' fa-msg-sheet-item--danger' : ''}`}
                    onClick={() => handleMessageAction(action.id, sheetMessage.id)}
                  >
                    {action.label}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="fa-msg-sheet-cancel" onClick={closeTransientMenus}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {forwardPickerMessageId ? (
        <div className="fa-msg-sheet-backdrop" role="presentation" onClick={closeTransientMenus}>
          <div
            className="fa-msg-sheet fa-msg-forward-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sc.forwardMessage}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeTransientMenus();
              }
            }}
          >
            <p className="fa-msg-sheet-title">{sc.forwardMessage}</p>
            {forwardDestinations.length === 0 ? (
              <p className="fa-msg-sheet-empty">{sc.noOtherStores}</p>
            ) : (
              <ul className="fa-msg-sheet-list">
                {forwardDestinations.map((target) => (
                  <li key={`${target.kind}:${target.id}`}>
                    <button
                      type="button"
                      className="fa-msg-sheet-item"
                      onClick={() => {
                        const source = messageById.get(forwardPickerMessageId);
                        if (source) void forwardMessage(source, target);
                      }}
                    >
                      {target.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="fa-msg-sheet-cancel" onClick={closeTransientMenus}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : null}

      <form
        className={`fa-composer fa-composer--store-chat fa-store-chat-composer${attachmentsEnabled ? ' fa-composer--with-attach' : ''}`}
        data-composer-enabled={composerEnabled ? 'true' : 'false'}
        onSubmit={(e) => void sendMessage(e)}
      >
        {sendError ? (
          <div className="fa-composer-error" role="alert">
            <span>{sendError}</span>
            <button type="button" className="fa-composer-retry" onClick={() => void sendMessage()}>
              {t.common.retry}
            </button>
          </div>
        ) : null}
        {sending ? (
          <div className="fa-composer-status" aria-live="polite">
            <FloatingAssistantLoader label={sc.sending} />
          </div>
        ) : null}
        {replyTargetMessageId ? (
          <div className="fa-reply-preview" role="status" aria-live="polite">
            <div className="fa-reply-preview-text">
              <span className="fa-reply-preview-label">
                {sc.replyingTo.replace(
                  '{name}',
                  replyTarget?.senderNameSnapshot || sc.message,
                )}
              </span>
              <span className="fa-reply-preview-body">
                {replyTarget ? quotePreviewText(replyTarget, sc) : sc.originalUnavailable}
              </span>
            </div>
            <button
              type="button"
              className="fa-reply-preview-cancel"
              onClick={() => setReplyTargetMessageId('')}
            >
              {t.common.cancel}
            </button>
          </div>
        ) : null}

        {attachmentStaging.staged ? (
          <ChatAttachmentPreview
            item={attachmentStaging.staged}
            phase={attachmentStaging.phase}
            uploadProgress={attachmentStaging.uploadProgress}
            hint={sc.readyToSend}
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
            onRetry={() => void sendMessage()}
            removeLabel={sc.removeAttachment}
            retryLabel={t.common.retry}
            previewAriaLabel={sc.attachmentPreview}
          />
        ) : selectedGiphy ? (
          <GiphyMediaPreview
            item={selectedGiphy}
            onClear={() => setSelectedGiphy(null)}
            ambientGlow={!hidden}
          />
        ) : null}

        {attachmentsEnabled && composerEnabled ? (
          <button
            type="button"
            ref={attachBtnRef}
            className="fa-composer-attach"
            disabled={sending}
            aria-label={sc.attach}
            aria-haspopup="dialog"
            aria-expanded={attachMenuOpen}
            onClick={() => {
              setAttachMenuOpen((v) => !v);
              setGiphyPickerOpen(false);
            }}
          >
            +
          </button>
        ) : null}

        <div className="fa-composer-input-wrap">
          {showMentionMenu ? (
            <ul className="fa-mention-menu" role="listbox" aria-label="Mention suggestions">
              {menuItems.map((item, i) => {
                const selected = i === mentionIndex;
                if (item.kind === 'all') {
                  return (
                    <li key="all" role="option" aria-selected={selected}>
                      <button
                        type="button"
                        className={`fa-mention-option${selected ? ' fa-mention-option--active' : ''}`}
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          applyMentionItem(item);
                        }}
                      >
                        <span className="fa-mention-option-avatar fa-mention-option-avatar--all">
                          @
                        </span>
                        <span className="fa-mention-option-text">
                          <span className="fa-mention-option-name">@all</span>
                          <span className="fa-mention-option-meta">Notify everyone</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                const c = item.candidate;
                return (
                  <li key={c.userId} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={`fa-mention-option${selected ? ' fa-mention-option--active' : ''}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        applyMentionItem(item);
                      }}
                    >
                      <span className="fa-mention-option-avatar">
                        <ProfileAvatar profile={c.profile} size={24} />
                      </span>
                      <span className="fa-mention-option-text">
                        <span className="fa-mention-option-name">{c.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label className="sr-only" htmlFor={`${panelId}-composer`}>
            Message
          </label>
          <textarea
            id={`${panelId}-composer`}
            ref={textareaRef}
            className="fa-composer-input"
            value={draft}
            disabled={!composerEnabled || sending}
            onChange={(e) => updateDraft(e.target.value)}
            onPaste={(e) => {
              if (!attachmentsEnabled || !composerEnabled) return;
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
            onClick={() => {
              syncCaretFromTextarea();
              const el = textareaRef.current;
              if (el) refreshMentionState(draft, el.selectionStart ?? 0);
            }}
            onSelect={() => {
              syncCaretFromTextarea();
              const el = textareaRef.current;
              if (el) refreshMentionState(draft, el.selectionStart ?? 0);
            }}
            onFocus={() => {
              if (!hidden) composerVisual.onFocus();
            }}
            onBlur={() => {
              if (!hidden) composerVisual.onBlur();
              window.setTimeout(() => setMentionOpen(false), 150);
            }}
            onKeyDown={onComposerKey}
            rows={2}
            maxLength={GROUP_CHAT_MAX_BODY}
            placeholder={placeholder}
            aria-disabled={!composerEnabled}
            aria-autocomplete="list"
            aria-expanded={showMentionMenu}
          />
        </div>
        {giphyConfigured && composerEnabled ? (
          <button
            type="button"
            ref={mediaBtnRef}
            className="fa-composer-media"
            disabled={sending}
            aria-label={sc.addGif}
            aria-expanded={giphyPickerOpen && giphyPickerMode === 'composer'}
            onClick={openComposerGiphyPicker}
          >
            {sc.gif}
          </button>
        ) : null}
        <button
          type="submit"
          className="fa-composer-send"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
        >
          {t.common.send}
        </button>
      </form>

      {attachmentsEnabled && composerEnabled ? (
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

      {giphyPickerOpen ? (
        <Suspense fallback={null}>
          <GiphyPicker
            open
            onClose={() => {
              setGiphyPickerOpen(false);
              setGiphyReactionTargetMessageId('');
              restoreFocus();
            }}
            onSelect={handleGiphyPickerSelect}
            anchorRef={mediaBtnRef}
          />
        </Suspense>
      ) : null}

      {detailsOpen ? (
        <div className="fa-modal-backdrop" onClick={closeDetails}>
          <div
            className="fa-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Group details"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="fa-modal-header">
              <h3>{room?.name}</h3>
              <button
                type="button"
                className="fa-panel-close"
                aria-label="Close"
                onClick={closeDetails}
              >
                ×
              </button>
            </header>
            <div className="fa-modal-body">
              <p className="small">{room?.description || 'No description.'}</p>

              {canManage ? (
                <div className="fa-group-manage-rename">
                  {renaming ? (
                    <label className="fa-field">
                      <span>Group name</span>
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        maxLength={80}
                        autoFocus
                      />
                      <div className="fa-modal-actions">
                        <button
                          type="button"
                          className="fa-btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            setRenaming(false);
                            setRenameValue(room?.name || '');
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="fa-btn-primary"
                          disabled={busy}
                          onClick={() => void submitRename()}
                        >
                          Save name
                        </button>
                      </div>
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="fa-btn-secondary"
                      disabled={busy}
                      onClick={() => setRenaming(true)}
                    >
                      Rename group
                    </button>
                  )}
                </div>
              ) : null}

              <h4 className="fa-group-members-heading">Members</h4>
              <ul className="fa-group-members-list">
                {members.map((m) => {
                  const p = memberProfile(m);
                  const name = p?.displayName || p?.email || m.userId;
                  const canRemove =
                    canManage &&
                    m.userId !== profile.userId &&
                    !(m.roomRole === 'owner' && ownerCount <= 1) &&
                    m.roomRole !== 'owner';
                  return (
                    <li key={m.id} className="fa-group-member-row">
                      <span className="fa-group-member-identity">
                        <IdentityWithAvatar profile={p} size={20}>
                          {name} · {m.roomRole}
                        </IdentityWithAvatar>
                      </span>
                      {canRemove ? (
                        <span className="fa-group-member-actions">
                          <button
                            type="button"
                            className="fa-btn-secondary fa-btn-compact"
                            disabled={busy}
                            onClick={() => void removeMember(m.userId)}
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {canManage && pendingInvites.length > 0 ? (
                <>
                  <h4 className="fa-group-members-heading">Pending invites</h4>
                  <ul className="fa-group-members-list">
                    {pendingInvites.map((inv) => {
                      const p = inviteeProfile(inv);
                      const name =
                        p?.displayName ||
                        p?.email ||
                        profileLabelById.get(inv.inviteeProfileId) ||
                        inv.inviteeProfileId ||
                        inv.inviteeUserId;
                      return (
                        <li key={inv.id} className="fa-group-member-row">
                          <span className="fa-group-member-identity">
                            <IdentityWithAvatar profile={p} size={20}>
                              {name} · pending
                            </IdentityWithAvatar>
                          </span>
                          <span className="fa-group-member-actions">
                            <button
                              type="button"
                              className="fa-btn-secondary fa-btn-compact"
                              disabled={busy}
                              onClick={() => void remindPendingInvite(inv.id)}
                            >
                              Remind
                            </button>
                            <button
                              type="button"
                              className="fa-btn-secondary fa-btn-compact"
                              disabled={busy}
                              onClick={() => void cancelPendingInvite(inv.id)}
                            >
                              Cancel
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}

              {canManage ? (
                <div className="fa-group-add-members">
                  {!addMembersOpen ? (
                    <button
                      type="button"
                      className="fa-btn-primary"
                      disabled={busy}
                      onClick={() => setAddMembersOpen(true)}
                    >
                      Add members
                    </button>
                  ) : (
                    <div className="fa-create-group-step">
                      <label className="fa-field">
                        <span>Search people</span>
                        <input
                          value={inviteSearch}
                          onChange={(e) => setInviteSearch(e.target.value)}
                          placeholder="Name, role, store…"
                          autoFocus
                        />
                      </label>
                      <ul className="fa-create-group-picker" aria-label="Invite candidates">
                        {inviteCandidates.map((c) => {
                          const checked = selectedInviteIds.includes(c.profile.id);
                          return (
                            <li key={c.profile.id}>
                              <label
                                className={`fa-create-group-pick${c.disabled ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={c.disabled}
                                  onChange={() => toggleInviteId(c.profile.id, c.disabled)}
                                />
                                <span>
                                  <strong>{c.label}</strong>
                                  <span className="small">
                                    {' '}
                                    · {c.profile.role}
                                    {c.reason ? ` · ${c.reason}` : ''}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="small" aria-live="polite">
                        {selectedInviteIds.length} selected
                      </p>
                      <div className="fa-modal-actions">
                        <button
                          type="button"
                          className="fa-btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            setAddMembersOpen(false);
                            setSelectedInviteIds([]);
                            setInviteSearch('');
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="fa-btn-primary"
                          disabled={busy || !selectedInviteIds.length}
                          onClick={() => void inviteSelectedMembers()}
                        >
                          {busy ? 'Inviting…' : 'Send invites'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="fa-modal-actions">
                <button
                  type="button"
                  className="fa-btn-secondary fa-btn-compact"
                  disabled={busy}
                  onClick={() => void leaveOrArchive()}
                >
                  {myMembership?.roomRole === 'owner' ? 'Archive group' : 'Leave group'}
                </button>
              </div>
              {manageError ? (
                <p className="fa-create-group-error" role="alert">
                  {manageError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
