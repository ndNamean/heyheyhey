/**
 * Chat attachment MIME / size / extension policy.
 * Images (Phase 2): jpeg/png/webp max 5MB.
 * Files (Phase 3): pdf / text / common Office max 10MB.
 * Keep in sync with api/_lib/chat-attachment/policy.js.
 */

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const CHAT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const CHAT_FILE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type ChatAttachmentKind = 'image' | 'file';

/** Extensions never allowed (executables, archives, HTML, scripts). */
export const CHAT_BLOCKED_EXTENSIONS = [
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'scr',
  'ps1',
  'vbs',
  'js',
  'mjs',
  'cjs',
  'html',
  'htm',
  'svg',
  'xhtml',
  'php',
  'asp',
  'aspx',
  'jsp',
  'sh',
  'bash',
  'zsh',
  'dll',
  'so',
  'dylib',
  'jar',
  'apk',
  'ipa',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
] as const;

const IMAGE_MIME_SET = new Set<string>(CHAT_IMAGE_MIME_TYPES);
const FILE_MIME_SET = new Set<string>(CHAT_FILE_MIME_TYPES);
const BLOCKED_EXT_SET = new Set<string>(CHAT_BLOCKED_EXTENSIONS);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
};

export function normalizeChatAttachmentMime(mimeType: string): string {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function chatAttachmentKindForMime(
  mimeType: string,
): ChatAttachmentKind | null {
  const mime = normalizeChatAttachmentMime(mimeType);
  if (IMAGE_MIME_SET.has(mime)) return 'image';
  if (FILE_MIME_SET.has(mime)) return 'file';
  return null;
}

export function maxBytesForChatAttachmentKind(kind: ChatAttachmentKind): number {
  return kind === 'image' ? CHAT_IMAGE_MAX_BYTES : CHAT_FILE_MAX_BYTES;
}

export function extensionForChatAttachmentMime(mimeType: string): string | null {
  const mime = normalizeChatAttachmentMime(mimeType);
  return MIME_TO_EXT[mime] ?? null;
}

export function fileExtensionFromName(fileName: string): string {
  const base = String(fileName || '').trim().split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isBlockedChatAttachmentExtension(ext: string): boolean {
  return BLOCKED_EXT_SET.has(String(ext || '').trim().toLowerCase());
}

/** Safe basename for storage paths (no separators / traversal). */
export function sanitizeChatAttachmentFileName(
  fileName: string,
  mimeType: string,
): string {
  const raw = String(fileName || '').trim().split(/[/\\]/).pop() || 'attachment';
  const withoutNulls = raw.replace(/\0/g, '');
  const cleaned = withoutNulls
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  const ext = extensionForChatAttachmentMime(mimeType);
  const currentExt = fileExtensionFromName(cleaned);
  if (ext && currentExt !== ext) {
    const stem = cleaned.replace(/\.[^.]+$/, '') || 'attachment';
    return `${stem}.${ext}`;
  }
  if (!cleaned) return ext ? `attachment.${ext}` : 'attachment';
  return cleaned;
}

export type ChatAttachmentPolicyErrorCode =
  | 'invalid_type'
  | 'blocked_extension'
  | 'too_large'
  | 'empty';

export interface ChatAttachmentPolicyResult {
  ok: boolean;
  kind?: ChatAttachmentKind;
  mimeType?: string;
  maxBytes?: number;
  errorCode?: ChatAttachmentPolicyErrorCode;
  errorMessage?: string;
}

export function validateChatAttachmentPolicy(input: {
  mimeType: string;
  bytes: number;
  fileName?: string;
}): ChatAttachmentPolicyResult {
  const mimeType = normalizeChatAttachmentMime(input.mimeType);
  const bytes = Number(input.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return {
      ok: false,
      errorCode: 'empty',
      errorMessage: 'File is empty.',
    };
  }

  const kind = chatAttachmentKindForMime(mimeType);
  if (!kind) {
    return {
      ok: false,
      errorCode: 'invalid_type',
      errorMessage:
        'Unsupported file type. Use JPEG, PNG, WebP, PDF, text, or Office documents.',
    };
  }

  const extFromName = fileExtensionFromName(input.fileName || '');
  if (extFromName && isBlockedChatAttachmentExtension(extFromName)) {
    return {
      ok: false,
      errorCode: 'blocked_extension',
      errorMessage: 'This file type is not allowed.',
    };
  }

  const maxBytes = maxBytesForChatAttachmentKind(kind);
  if (bytes > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      kind,
      mimeType,
      maxBytes,
      errorCode: 'too_large',
      errorMessage: `File too large. Max ${mb}MB.`,
    };
  }

  return { ok: true, kind, mimeType, maxBytes };
}
