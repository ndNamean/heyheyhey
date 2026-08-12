/**
 * Store Chat media payload composition (Phase 4 + attachments Phase 1).
 * Combines text / GIPHY / attachment / reply / mention fields into InstantDB-ready message attrs.
 *
 * Empty-string defaults keep clientRequired schema fields safe for text-only sends.
 * StoreChatPanel `sendMessage` uses `buildStoreChatMediaPayload`; picker selection
 * stages into composer preview first (no auto-send).
 * GroupChatPanel uses `buildGroupChatMediaPayload` (same media/social fields, no logbook).
 * Attachment XOR GIPHY: when attachment is present, GIPHY fields stay empty.
 */

import type { GiphyMediaItem, GiphyMediaKind } from './giphyClient';
import { serializeMentionedUserIds } from './storeChatMentions';

export type StoreChatMediaMessageType =
  | 'text'
  | 'giphy_media'
  | 'text_giphy'
  | 'attachment'
  | 'text_attachment';

/** Schema-aligned GIPHY fields (all clientRequired; '' when unused). */
export interface StoreChatGiphyFields {
  giphyId: string;
  giphyKind: string;
  giphyTitle: string;
  giphyWidth: string;
  giphyHeight: string;
  giphyUrl: string;
  giphyPreviewUrl: string;
}

/** Schema-aligned attachment fields (all clientRequired; '' when unused). */
export interface StoreChatAttachmentFields {
  attachmentKind: string;
  attachmentPath: string;
  attachmentFileId: string;
  attachmentUrl: string;
  attachmentMimeType: string;
  attachmentFileName: string;
  attachmentBytes: string;
  attachmentWidth: string;
  attachmentHeight: string;
}

export type ChatAttachmentKindValue = 'image' | 'file';

/** Uploaded attachment ready to persist on a chat message. */
export interface ChatAttachmentPayloadInput {
  kind: ChatAttachmentKindValue;
  path: string;
  fileId: string;
  url: string;
  mimeType: string;
  fileName: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
}

export interface StoreChatForwardFields {
  forwardedFromMessageId: string;
  forwardedFromUserId: string;
}

/** Admin logbook/report system-card fields — empty on human client messages. */
export interface StoreChatLogbookFields {
  sourceType: string;
  logbookEntryId: string;
  reportId: string;
  logbookEventType: string;
  actionType: string;
  targetUserIdsJson: string;
  deepLinkJson: string;
  statusSnapshot: string;
  chatDeliveryKey: string;
}

export interface StoreChatMediaPayloadInput {
  body: string;
  giphy?: GiphyMediaItem | null;
  /** When set, GIPHY is ignored (mutual exclusion). */
  attachment?: ChatAttachmentPayloadInput | null;
  replyToMessageId?: string | null;
  mentionedUserIds?: string[];
  mentionAll?: boolean;
  forwardedFromMessageId?: string | null;
  forwardedFromUserId?: string | null;
  clientMutationId?: string | null;
}

/** Shared social/media attrs (Store + Group). */
export interface ChatMediaSocialAttrs
  extends StoreChatGiphyFields,
    StoreChatAttachmentFields,
    StoreChatForwardFields {
  messageType: StoreChatMediaMessageType;
  body: string;
  replyToMessageId: string;
  mentionedUserIdsJson: string;
  mentionAll: boolean;
  clientMutationId: string;
}

/** Full Instant update blob for storeChatMessages (media + social metadata). */
export interface StoreChatMediaMessageAttrs
  extends ChatMediaSocialAttrs,
    StoreChatLogbookFields {}

/** Instant update blob for groupChatMessages (no logbook fields). */
export type GroupChatMediaMessageAttrs = ChatMediaSocialAttrs;

export const EMPTY_GIPHY_FIELDS: StoreChatGiphyFields = {
  giphyId: '',
  giphyKind: '',
  giphyTitle: '',
  giphyWidth: '',
  giphyHeight: '',
  giphyUrl: '',
  giphyPreviewUrl: '',
};

export const EMPTY_ATTACHMENT_FIELDS: StoreChatAttachmentFields = {
  attachmentKind: '',
  attachmentPath: '',
  attachmentFileId: '',
  attachmentUrl: '',
  attachmentMimeType: '',
  attachmentFileName: '',
  attachmentBytes: '',
  attachmentWidth: '',
  attachmentHeight: '',
};

export const EMPTY_FORWARD_FIELDS: StoreChatForwardFields = {
  forwardedFromMessageId: '',
  forwardedFromUserId: '',
};

export const EMPTY_LOGBOOK_FIELDS: StoreChatLogbookFields = {
  sourceType: '',
  logbookEntryId: '',
  reportId: '',
  logbookEventType: '',
  actionType: '',
  targetUserIdsJson: '',
  deepLinkJson: '',
  statusSnapshot: '',
  chatDeliveryKey: '',
};

export function emptyStoreChatGiphyFields(): StoreChatGiphyFields {
  return { ...EMPTY_GIPHY_FIELDS };
}

export function emptyStoreChatAttachmentFields(): StoreChatAttachmentFields {
  return { ...EMPTY_ATTACHMENT_FIELDS };
}

export function normalizeStoreChatMessageType(
  body: string,
  hasGiphy: boolean,
  hasAttachment = false,
): StoreChatMediaMessageType {
  const hasText = body.trim().length > 0;
  if (hasAttachment && hasText) return 'text_attachment';
  if (hasAttachment) return 'attachment';
  if (hasGiphy && hasText) return 'text_giphy';
  if (hasGiphy) return 'giphy_media';
  return 'text';
}

export function giphyItemToFields(item: GiphyMediaItem): StoreChatGiphyFields {
  return {
    giphyId: item.id.trim(),
    giphyKind: item.kind,
    giphyTitle: item.title.trim(),
    giphyWidth: String(Math.max(0, Math.round(item.width)) || ''),
    giphyHeight: String(Math.max(0, Math.round(item.height)) || ''),
    giphyUrl: item.url.trim(),
    giphyPreviewUrl: (item.previewUrl || item.url).trim(),
  };
}

export function attachmentInputToFields(
  item: ChatAttachmentPayloadInput,
): StoreChatAttachmentFields {
  const width = item.width != null ? Math.max(0, Math.round(Number(item.width))) : 0;
  const height =
    item.height != null ? Math.max(0, Math.round(Number(item.height))) : 0;
  const bytes = Math.max(0, Math.round(Number(item.bytes) || 0));
  return {
    attachmentKind: item.kind === 'file' ? 'file' : 'image',
    attachmentPath: String(item.path || '').trim(),
    attachmentFileId: String(item.fileId || '').trim(),
    attachmentUrl: String(item.url || '').trim(),
    attachmentMimeType: String(item.mimeType || '').trim().toLowerCase(),
    attachmentFileName: String(item.fileName || '').trim(),
    attachmentBytes: bytes > 0 ? String(bytes) : '',
    attachmentWidth: width > 0 ? String(width) : '',
    attachmentHeight: height > 0 ? String(height) : '',
  };
}

export function isGiphyKind(value: string): value is GiphyMediaKind {
  return value === 'gif' || value === 'sticker' || value === 'meme' || value === 'emoji';
}

export function hasGiphyMedia(fields: Pick<StoreChatGiphyFields, 'giphyId' | 'giphyUrl'>): boolean {
  return Boolean(fields.giphyId?.trim() || fields.giphyUrl?.trim());
}

export function hasChatAttachment(
  fields: Pick<StoreChatAttachmentFields, 'attachmentPath' | 'attachmentFileId'>,
): boolean {
  return Boolean(fields.attachmentPath?.trim() || fields.attachmentFileId?.trim());
}

/** Compose shared media/social attrs for Store or Group chat sends. */
export function buildChatMediaSocialPayload(
  input: StoreChatMediaPayloadInput,
): ChatMediaSocialAttrs {
  const body = String(input.body ?? '');
  const attachment = input.attachment ?? null;
  const hasAttachment = Boolean(
    attachment &&
      (String(attachment.path || '').trim() || String(attachment.fileId || '').trim()),
  );
  // XOR: attachment wins over GIPHY when both are somehow provided.
  const giphy = hasAttachment ? null : input.giphy ?? null;
  const giphyFields = giphy ? giphyItemToFields(giphy) : emptyStoreChatGiphyFields();
  const attachmentFields = hasAttachment
    ? attachmentInputToFields(attachment!)
    : emptyStoreChatAttachmentFields();
  const messageType = normalizeStoreChatMessageType(
    body,
    Boolean(giphy),
    hasAttachment,
  );

  return {
    messageType,
    body,
    replyToMessageId: String(input.replyToMessageId ?? '').trim(),
    mentionedUserIdsJson: serializeMentionedUserIds(input.mentionedUserIds ?? []),
    mentionAll: Boolean(input.mentionAll),
    clientMutationId: String(input.clientMutationId ?? '').trim(),
    forwardedFromMessageId: String(input.forwardedFromMessageId ?? '').trim(),
    forwardedFromUserId: String(input.forwardedFromUserId ?? '').trim(),
    ...giphyFields,
    ...attachmentFields,
  };
}

/**
 * Compose InstantDB message attributes for text / giphy / attachment,
 * including optional reply + mention + forward metadata.
 */
export function buildStoreChatMediaPayload(
  input: StoreChatMediaPayloadInput,
): StoreChatMediaMessageAttrs {
  return {
    ...buildChatMediaSocialPayload(input),
    ...EMPTY_LOGBOOK_FIELDS,
  };
}

/** Group Chat message attrs — same social/media fields, no logbook keys. */
export function buildGroupChatMediaPayload(
  input: StoreChatMediaPayloadInput,
): GroupChatMediaMessageAttrs {
  return buildChatMediaSocialPayload(input);
}

/** True when the composer can send (text and/or selected GIPHY / attachment). */
export function canSendStoreChatMedia(
  body: string,
  giphy: GiphyMediaItem | null | undefined,
  attachment?: ChatAttachmentPayloadInput | null,
): boolean {
  const hasAttachment = Boolean(
    attachment &&
      (String(attachment.path || '').trim() || String(attachment.fileId || '').trim()),
  );
  return Boolean(body.trim() || giphy?.id || hasAttachment);
}

/** Alias for group composer send gate. */
export const canSendGroupChatMedia = canSendStoreChatMedia;

/** Human label for reply quotes / notifications. */
export function storeChatMediaLabel(
  messageType: string,
  giphyKind?: string,
  attachmentKind?: string,
): string {
  const type = String(messageType || 'text');
  if (type === 'attachment' || type === 'text_attachment') {
    return String(attachmentKind || '').trim() === 'file' ? 'File' : 'Photo';
  }
  if (type === 'text') return 'Message';
  const kind = (giphyKind || '').trim();
  if (kind === 'sticker') return 'Sticker';
  if (kind === 'emoji') return 'Animated emoji';
  if (kind === 'meme') return 'Meme';
  if (type === 'text_giphy') return 'GIF + text';
  return 'GIF';
}

export const groupChatMediaLabel = storeChatMediaLabel;
