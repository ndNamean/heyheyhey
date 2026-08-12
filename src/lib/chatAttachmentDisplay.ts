/**
 * Shared display helpers for chat attachment bubbles / errors.
 */

import type { ChatAttachmentPolicyErrorCode } from './chatAttachmentPolicy';
import { hasChatAttachment } from './storeChatMediaPayload';

export function formatChatAttachmentBytes(bytes: number | string | null | undefined): string {
  const n = typeof bytes === 'string' ? Number.parseInt(bytes, 10) : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function resolveChatAttachmentUrl(message: {
  attachmentUrl?: string;
  attachmentFile?: { url?: string } | null;
}): string {
  return String(message.attachmentFile?.url || message.attachmentUrl || '').trim();
}

export function messageHasChatAttachment(message: {
  attachmentPath?: string;
  attachmentFileId?: string;
  attachmentUrl?: string;
  attachmentFile?: { url?: string; id?: string } | null;
}): boolean {
  return (
    hasChatAttachment({
      attachmentPath: message.attachmentPath || '',
      attachmentFileId: message.attachmentFileId || '',
    }) || Boolean(resolveChatAttachmentUrl(message))
  );
}

export function chatAttachmentPolicyErrorCopy(
  code: ChatAttachmentPolicyErrorCode | string | undefined,
  sc: {
    attachmentTooLarge: string;
    attachmentInvalidType: string;
    attachmentBlocked: string;
    attachmentEmpty: string;
    uploadFailed: string;
  },
): string {
  switch (code) {
    case 'too_large':
      return sc.attachmentTooLarge;
    case 'invalid_type':
      return sc.attachmentInvalidType;
    case 'blocked_extension':
      return sc.attachmentBlocked;
    case 'empty':
      return sc.attachmentEmpty;
    default:
      return sc.uploadFailed;
  }
}
