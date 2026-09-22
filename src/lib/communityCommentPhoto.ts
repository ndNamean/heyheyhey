/**
 * Community comment/reply photo or video content (not a GIF body, not a reaction).
 * Reuses chat image/video policy + Instant attachment field helpers.
 */

import {
  validateChatAttachmentPolicy,
  type ChatAttachmentPolicyErrorCode,
} from './chatAttachmentPolicy';
import { resolveChatAttachmentUrl } from './chatAttachmentDisplay';
import type { CommunityComment } from '../types';
import {
  attachmentInputToFields,
  emptyStoreChatAttachmentFields,
  type ChatAttachmentPayloadInput,
  type StoreChatAttachmentFields,
} from './storeChatMediaPayload';

export type CommunityCommentPhotoFields = StoreChatAttachmentFields;

export type StagedCommunityCommentPhoto = {
  blob: Blob;
  objectUrl: string;
  mimeType: string;
  fileName: string;
  bytes: number;
  width: number;
  height: number;
};

export function emptyCommunityCommentPhotoFields(): CommunityCommentPhotoFields {
  return emptyStoreChatAttachmentFields();
}

export function buildCommunityCommentPhotoPayload(
  input?: ChatAttachmentPayloadInput | null,
): CommunityCommentPhotoFields {
  return input ? attachmentInputToFields(input) : emptyCommunityCommentPhotoFields();
}

export function commentHasPhotoContent(
  comment: Pick<
    CommunityComment,
    'attachmentKind' | 'attachmentPath' | 'attachmentFileId' | 'attachmentUrl' | 'attachmentFile'
  >,
): boolean {
  if ((comment.attachmentKind || '').trim() !== 'image') return false;
  return Boolean(commentPhotoDisplayUrl(comment));
}

export function commentHasVideoContent(
  comment: Pick<
    CommunityComment,
    'attachmentKind' | 'attachmentPath' | 'attachmentFileId' | 'attachmentUrl' | 'attachmentFile'
  >,
): boolean {
  if ((comment.attachmentKind || '').trim() !== 'video') return false;
  return Boolean(commentVideoDisplayUrl(comment));
}

export function commentPhotoDisplayUrl(
  comment: Pick<CommunityComment, 'attachmentUrl' | 'attachmentFile' | 'attachmentPath'>,
): string {
  return resolveChatAttachmentUrl(comment);
}

export function commentVideoDisplayUrl(
  comment: Pick<CommunityComment, 'attachmentUrl' | 'attachmentFile' | 'attachmentPath'>,
): string {
  return resolveChatAttachmentUrl(comment);
}

export function commentPhotoPayloadFromUpload(
  uploaded: ChatAttachmentPayloadInput,
  dims?: { width?: number; height?: number },
): ChatAttachmentPayloadInput {
  return {
    ...uploaded,
    width: dims?.width ?? uploaded.width ?? null,
    height: dims?.height ?? uploaded.height ?? null,
  };
}

function createPreviewUrl(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  try {
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

function revokeUrl(url: string | null | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function readImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const url = createPreviewUrl(blob);
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      revokeUrl(url);
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    img.onerror = () => {
      revokeUrl(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function stageCommunityCommentPhoto(
  file: File,
): Promise<
  | { ok: true; photo: StagedCommunityCommentPhoto }
  | { ok: false; code: ChatAttachmentPolicyErrorCode }
> {
  const mimeType = String(file.type || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const policy = validateChatAttachmentPolicy({
    mimeType,
    bytes: file.size,
    fileName: file.name,
  });
  if (!policy.ok) return { ok: false, code: policy.errorCode || 'invalid_type' };
  if (policy.kind !== 'image') return { ok: false, code: 'invalid_type' };
  const dims = await readImageDimensions(file);
  return {
    ok: true,
    photo: {
      blob: file,
      objectUrl: createPreviewUrl(file),
      mimeType,
      fileName: file.name || 'photo.jpg',
      bytes: file.size,
      width: dims?.width || 0,
      height: dims?.height || 0,
    },
  };
}

export function revokeCommunityCommentPhoto(photo: StagedCommunityCommentPhoto | null | undefined) {
  revokeUrl(photo?.objectUrl);
}
