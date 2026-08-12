/**
 * Server mirror of src/lib/chatAttachmentPolicy.ts — keep allowlists in sync.
 */

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const CHAT_FILE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

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
];

const IMAGE_MIME_SET = new Set(CHAT_IMAGE_MIME_TYPES);
const FILE_MIME_SET = new Set(CHAT_FILE_MIME_TYPES);
const BLOCKED_EXT_SET = new Set(CHAT_BLOCKED_EXTENSIONS);

const MIME_TO_EXT = {
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

export function normalizeChatAttachmentMime(mimeType) {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function chatAttachmentKindForMime(mimeType) {
  const mime = normalizeChatAttachmentMime(mimeType);
  if (IMAGE_MIME_SET.has(mime)) return 'image';
  if (FILE_MIME_SET.has(mime)) return 'file';
  return null;
}

export function maxBytesForChatAttachmentKind(kind) {
  return kind === 'image' ? CHAT_IMAGE_MAX_BYTES : CHAT_FILE_MAX_BYTES;
}

export function extensionForChatAttachmentMime(mimeType) {
  const mime = normalizeChatAttachmentMime(mimeType);
  return MIME_TO_EXT[mime] ?? null;
}

export function fileExtensionFromName(fileName) {
  const base = String(fileName || '').trim().split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isBlockedChatAttachmentExtension(ext) {
  return BLOCKED_EXT_SET.has(String(ext || '').trim().toLowerCase());
}

export function sanitizeChatAttachmentFileName(fileName, mimeType) {
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

export function validateChatAttachmentPolicy({ mimeType, bytes, fileName }) {
  const mime = normalizeChatAttachmentMime(mimeType);
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, errorCode: 'empty', errorMessage: 'File is empty.' };
  }

  const kind = chatAttachmentKindForMime(mime);
  if (!kind) {
    return {
      ok: false,
      errorCode: 'invalid_type',
      errorMessage:
        'Unsupported file type. Use JPEG, PNG, WebP, PDF, text, or Office documents.',
    };
  }

  const extFromName = fileExtensionFromName(fileName || '');
  if (extFromName && isBlockedChatAttachmentExtension(extFromName)) {
    return {
      ok: false,
      errorCode: 'blocked_extension',
      errorMessage: 'This file type is not allowed.',
    };
  }

  const maxBytes = maxBytesForChatAttachmentKind(kind);
  if (size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      kind,
      mimeType: mime,
      maxBytes,
      errorCode: 'too_large',
      errorMessage: `File too large. Max ${mb}MB.`,
    };
  }

  return { ok: true, kind, mimeType: mime, maxBytes };
}

/**
 * Lightweight magic-byte check. Returns true when bytes match declared MIME,
 * or when the format cannot be sniffsed reliably (plain text / some Office).
 */
export function bufferMatchesDeclaredMime(buffer, mimeType) {
  const mime = normalizeChatAttachmentMime(mimeType);
  if (!buffer || buffer.length < 4) return false;

  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mime === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  if (mime === 'application/pdf') {
    return buffer.toString('ascii', 0, 4) === '%PDF';
  }
  if (mime === 'text/plain') {
    // Reject obvious binary / HTML / script payloads claimed as text.
    const sample = buffer.slice(0, Math.min(buffer.length, 512)).toString('utf8');
    if (/[\u0000]/.test(sample)) return false;
    if (/^\s*<(!DOCTYPE|html|script)/i.test(sample)) return false;
    return true;
  }
  // OLE Compound File (legacy .doc/.xls/.ppt)
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint'
  ) {
    return (
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0
    );
  }
  // ZIP-based OOXML (.docx/.xlsx/.pptx)
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  return false;
}

export const EMPTY_CHAT_ATTACHMENT_FIELDS = {
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

export function sanitizePathSegment(value, fallback = 'x') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Storage path under Instant `$files`.
 * Group chat rooms are not store-scoped — never require authorizedStores for path.
 * Paths stay under `stores/` so Admin uploads remain consistent with client $files rules.
 */
export function buildChatAttachmentStoragePath({
  scope,
  storeId,
  roomId,
  messageKey,
  fileName,
}) {
  const key = String(messageKey || '').trim() || 'msg';
  const name = String(fileName || '').trim() || 'attachment';
  if (scope === 'group') {
    const room = String(roomId || '').trim();
    return `stores/group-chat/${room}/${key}/${name}`;
  }
  const store = String(storeId || '').trim();
  return `stores/${store}/chat/${key}/${name}`;
}
