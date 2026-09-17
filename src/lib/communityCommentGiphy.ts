/**
 * Community comment/reply GIF content (not a comment reaction, not a post reaction).
 * Reuses chat GIPHY field helpers so Instant payloads stay schema-aligned.
 */

import type { CommunityComment } from '../types';
import type { GiphyMediaItem, GiphyMediaKind } from './giphyClient';
import {
  emptyStoreChatGiphyFields,
  giphyItemToFields,
  isGiphyKind,
  type StoreChatGiphyFields,
} from './storeChatMediaPayload';

export const COMMENT_MAX_BODY = 2000;

export type CommunityCommentGiphyFields = StoreChatGiphyFields;

export function emptyCommunityCommentGiphyFields(): CommunityCommentGiphyFields {
  return emptyStoreChatGiphyFields();
}

/** Always send every GIF key; empty strings for text-only comments. */
export function buildCommunityCommentGiphyPayload(
  giphy?: GiphyMediaItem | null,
): CommunityCommentGiphyFields {
  return giphy ? giphyItemToFields(giphy) : emptyCommunityCommentGiphyFields();
}

export function commentHasGiphyContent(
  comment: Pick<CommunityComment, 'giphyId' | 'giphyUrl'>,
): boolean {
  return Boolean((comment.giphyId || '').trim() && (comment.giphyUrl || '').trim());
}

export function commentGiphyDisplayUrl(
  comment: Pick<CommunityComment, 'giphyUrl' | 'giphyPreviewUrl'>,
): string {
  return ((comment.giphyPreviewUrl || '').trim() || (comment.giphyUrl || '').trim());
}

export function commentToGiphyMediaItem(
  comment: Pick<
    CommunityComment,
    'giphyId' | 'giphyKind' | 'giphyTitle' | 'giphyWidth' | 'giphyHeight' | 'giphyUrl' | 'giphyPreviewUrl'
  >,
): GiphyMediaItem | null {
  const id = (comment.giphyId || '').trim();
  const url = (comment.giphyUrl || '').trim();
  if (!id || !url) return null;
  const kindRaw = (comment.giphyKind || '').trim();
  const kind: GiphyMediaKind = isGiphyKind(kindRaw) ? kindRaw : 'gif';
  return {
    id,
    kind,
    title: (comment.giphyTitle || '').trim(),
    width: Number.parseInt(comment.giphyWidth || '', 10) || 0,
    height: Number.parseInt(comment.giphyHeight || '', 10) || 0,
    url,
    previewUrl: ((comment.giphyPreviewUrl || '').trim() || url),
    username: '',
    itemUrl: '',
  };
}

export function canSendCommunityComment(
  body: string,
  giphy?: GiphyMediaItem | null,
): boolean {
  const text = body.trim();
  if (text.length > COMMENT_MAX_BODY) return false;
  if (text) return true;
  return Boolean(giphy && giphy.id.trim() && giphy.url.trim());
}

/** Client-side mirror of Instant comment-create GIF rules. */
export function communityCommentGiphyPermsOk(
  body: string,
  fields: CommunityCommentGiphyFields,
): boolean {
  if (body.length > COMMENT_MAX_BODY) return false;
  if (!body.trim() && !fields.giphyId.trim()) return false;
  if (!fields.giphyId.trim()) return true;
  return Boolean(fields.giphyUrl.trim() && isGiphyKind(fields.giphyKind));
}
