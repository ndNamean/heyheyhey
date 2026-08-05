/**
 * Store Chat media payload composition (Phase 4).
 * Combines text / GIPHY / reply / mention fields into InstantDB-ready message attrs.
 *
 * Empty-string defaults keep clientRequired schema fields safe for text-only sends.
 * StoreChatPanel `sendMessage` uses `buildStoreChatMediaPayload`; picker selection
 * stages into composer preview first (no auto-send).
 */

import type { GiphyMediaItem, GiphyMediaKind } from './giphyClient';
import { serializeMentionedUserIds } from './storeChatMentions';

export type StoreChatMediaMessageType = 'text' | 'giphy_media' | 'text_giphy';

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

export interface StoreChatForwardFields {
  forwardedFromMessageId: string;
  forwardedFromUserId: string;
}

/** Admin logbook system-card fields — empty on human client messages. */
export interface StoreChatLogbookFields {
  sourceType: string;
  logbookEntryId: string;
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
  replyToMessageId?: string | null;
  mentionedUserIds?: string[];
  mentionAll?: boolean;
  forwardedFromMessageId?: string | null;
  forwardedFromUserId?: string | null;
  clientMutationId?: string | null;
}

/** Full Instant update blob for storeChatMessages (media + social metadata). */
export interface StoreChatMediaMessageAttrs
  extends StoreChatGiphyFields,
    StoreChatForwardFields,
    StoreChatLogbookFields {
  messageType: StoreChatMediaMessageType;
  body: string;
  replyToMessageId: string;
  mentionedUserIdsJson: string;
  mentionAll: boolean;
  clientMutationId: string;
}

export const EMPTY_GIPHY_FIELDS: StoreChatGiphyFields = {
  giphyId: '',
  giphyKind: '',
  giphyTitle: '',
  giphyWidth: '',
  giphyHeight: '',
  giphyUrl: '',
  giphyPreviewUrl: '',
};

export const EMPTY_FORWARD_FIELDS: StoreChatForwardFields = {
  forwardedFromMessageId: '',
  forwardedFromUserId: '',
};

export const EMPTY_LOGBOOK_FIELDS: StoreChatLogbookFields = {
  sourceType: '',
  logbookEntryId: '',
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

export function normalizeStoreChatMessageType(
  body: string,
  hasGiphy: boolean,
): StoreChatMediaMessageType {
  const hasText = body.trim().length > 0;
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

export function isGiphyKind(value: string): value is GiphyMediaKind {
  return value === 'gif' || value === 'sticker' || value === 'meme' || value === 'emoji';
}

export function hasGiphyMedia(fields: Pick<StoreChatGiphyFields, 'giphyId' | 'giphyUrl'>): boolean {
  return Boolean(fields.giphyId?.trim() || fields.giphyUrl?.trim());
}

/**
 * Compose InstantDB message attributes for text / giphy / text+giphy,
 * including optional reply + mention + forward metadata.
 */
export function buildStoreChatMediaPayload(
  input: StoreChatMediaPayloadInput,
): StoreChatMediaMessageAttrs {
  const body = String(input.body ?? '');
  const giphy = input.giphy ?? null;
  const giphyFields = giphy ? giphyItemToFields(giphy) : emptyStoreChatGiphyFields();
  const messageType = normalizeStoreChatMessageType(body, Boolean(giphy));

  if (messageType === 'giphy_media' && !body.trim()) {
    // Keep body non-null; Instant requires string. Empty is fine for media-only.
  }

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
    ...EMPTY_LOGBOOK_FIELDS,
  };
}

/** True when the composer can send (text and/or selected GIPHY). */
export function canSendStoreChatMedia(body: string, giphy: GiphyMediaItem | null | undefined): boolean {
  return Boolean(body.trim() || giphy?.id);
}

/** Human label for reply quotes / notifications. */
export function storeChatMediaLabel(
  messageType: string,
  giphyKind?: string,
): string {
  const type = String(messageType || 'text');
  if (type === 'text') return 'Message';
  const kind = (giphyKind || '').trim();
  if (kind === 'sticker') return 'Sticker';
  if (kind === 'emoji') return 'Animated emoji';
  if (kind === 'meme') return 'Meme';
  if (type === 'text_giphy') return 'GIF + text';
  return 'GIF';
}
