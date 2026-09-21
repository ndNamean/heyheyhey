/**
 * Chat attachment MIME / size / extension policy.
 * Images (Phase 2): jpeg/png/webp max 5MB.
 * Files (Phase 3): pdf / text / common Office max 10MB.
 * Video: mp4/quicktime/webm max 50MB, Community scope only.
 * Keep in sync with api/_lib/chat-attachment/policy.js.
 */

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Client staging only — grant/Instant cannot see duration. */
export const CHAT_VIDEO_MAX_DURATION_SECONDS = 90;

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

export const CHAT_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

export type ChatAttachmentKind = 'image' | 'file' | 'video';
export type ChatAttachmentScope = 'store' | 'group' | 'community';

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
const VIDEO_MIME_SET = new Set<string>(CHAT_VIDEO_MIME_TYPES);
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
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
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
  if (VIDEO_MIME_SET.has(mime)) return 'video';
  return null;
}

export function maxBytesForChatAttachmentKind(kind: ChatAttachmentKind): number {
  if (kind === 'image') return CHAT_IMAGE_MAX_BYTES;
  if (kind === 'video') return CHAT_VIDEO_MAX_BYTES;
  return CHAT_FILE_MAX_BYTES;
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

function asBytes(buffer: Uint8Array | ArrayBuffer | { length: number; [i: number]: number }): Uint8Array {
  if (buffer instanceof Uint8Array) return buffer;
  if (typeof ArrayBuffer !== 'undefined' && buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  const len = Number(buffer.length) || 0;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = buffer[i] ?? 0;
  return out;
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function isIsoBmffFtyp(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && asciiAt(bytes, 4, 4) === 'ftyp';
}

function isWebmEbml(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

/**
 * Lightweight magic-byte check. Returns true when bytes match declared MIME,
 * or when the format cannot be sniffed reliably (plain text / some Office).
 */
export function bufferMatchesDeclaredMime(
  buffer: Uint8Array | ArrayBuffer | { length: number; [i: number]: number },
  mimeType: string,
): boolean {
  const mime = normalizeChatAttachmentMime(mimeType);
  const bytes = asBytes(buffer);
  if (!bytes.length || bytes.length < 4) return false;

  if (mime === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mime === 'image/webp') {
    return (
      bytes.length >= 12 &&
      asciiAt(bytes, 0, 4) === 'RIFF' &&
      asciiAt(bytes, 8, 4) === 'WEBP'
    );
  }
  if (mime === 'application/pdf') {
    return asciiAt(bytes, 0, 4) === '%PDF';
  }
  if (mime === 'text/plain') {
    const sampleLen = Math.min(bytes.length, 512);
    for (let i = 0; i < sampleLen; i++) {
      if (bytes[i] === 0) return false;
    }
    let sample = '';
    for (let i = 0; i < sampleLen; i++) sample += String.fromCharCode(bytes[i]!);
    if (/^\s*<(!DOCTYPE|html|script)/i.test(sample)) return false;
    return true;
  }
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint'
  ) {
    return (
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    );
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  if (mime === 'video/mp4' || mime === 'video/quicktime') {
    return isIsoBmffFtyp(bytes);
  }
  if (mime === 'video/webm') {
    return isWebmEbml(bytes);
  }
  return false;
}

export function validateChatAttachmentPolicy(input: {
  mimeType: string;
  bytes: number;
  fileName?: string;
  /** Video is accepted only when this is `'community'`. Missing scope rejects video. */
  scope?: ChatAttachmentScope | string;
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

  if (kind === 'video' && input.scope !== 'community') {
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
