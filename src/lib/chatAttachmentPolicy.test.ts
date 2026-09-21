import { describe, expect, it } from 'vitest';
import {
  CHAT_FILE_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_VIDEO_MAX_BYTES,
  bufferMatchesDeclaredMime,
  chatAttachmentKindForMime,
  isBlockedChatAttachmentExtension,
  sanitizeChatAttachmentFileName,
  validateChatAttachmentPolicy,
} from './chatAttachmentPolicy';
import { isChatAttachmentsEnabled } from './chatAttachmentsFlag';

function ftypBytes() {
  return Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
}

function webmBytes() {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
}

describe('chatAttachmentPolicy', () => {
  it('accepts image MIME within 5MB', () => {
    const result = validateChatAttachmentPolicy({
      mimeType: 'image/jpeg; charset=binary',
      bytes: 1024,
      fileName: 'photo.JPEG',
    });
    expect(result).toMatchObject({
      ok: true,
      kind: 'image',
      mimeType: 'image/jpeg',
      maxBytes: CHAT_IMAGE_MAX_BYTES,
    });
    expect(chatAttachmentKindForMime('image/png')).toBe('image');
  });

  it('accepts file MIME within 10MB', () => {
    const result = validateChatAttachmentPolicy({
      mimeType: 'application/pdf',
      bytes: CHAT_FILE_MAX_BYTES,
      fileName: 'doc.pdf',
    });
    expect(result).toMatchObject({
      ok: true,
      kind: 'file',
      mimeType: 'application/pdf',
      maxBytes: CHAT_FILE_MAX_BYTES,
    });
  });

  it('accepts community video MIME within 50MB and rejects other scopes', () => {
    expect(chatAttachmentKindForMime('video/mp4')).toBe('video');
    expect(chatAttachmentKindForMime('video/quicktime')).toBe('video');
    expect(chatAttachmentKindForMime('video/webm')).toBe('video');
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'video/mp4',
        bytes: CHAT_VIDEO_MAX_BYTES,
        fileName: 'clip.mp4',
        scope: 'community',
      }),
    ).toMatchObject({
      ok: true,
      kind: 'video',
      maxBytes: CHAT_VIDEO_MAX_BYTES,
    });
    const mib = 1024 * 1024;
    for (const bytes of [24 * mib, 25 * mib, 49 * mib, 50 * mib]) {
      expect(
        validateChatAttachmentPolicy({
          mimeType: 'video/mp4',
          bytes,
          fileName: 'clip.mp4',
          scope: 'community',
        }).ok,
      ).toBe(true);
    }
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'video/mp4',
        bytes: 1024,
        fileName: 'clip.mp4',
      }).errorCode,
    ).toBe('invalid_type');
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'video/quicktime',
        bytes: 1024,
        fileName: 'clip.mov',
        scope: 'store',
      }).errorCode,
    ).toBe('invalid_type');
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'video/webm',
        bytes: 1024,
        fileName: 'clip.webm',
        scope: 'group',
      }).errorCode,
    ).toBe('invalid_type');
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'video/mp4',
        bytes: CHAT_VIDEO_MAX_BYTES + 1,
        fileName: 'clip.mp4',
        scope: 'community',
      }).errorCode,
    ).toBe('too_large');
    for (const bytes of [50 * mib + 1, 51 * mib]) {
      expect(
        validateChatAttachmentPolicy({
          mimeType: 'video/mp4',
          bytes,
          fileName: 'clip.mp4',
          scope: 'community',
        }).errorCode,
      ).toBe('too_large');
    }
  });

  it('sniffs ISO-BMFF ftyp and WebM EBML for video MIME', () => {
    expect(bufferMatchesDeclaredMime(ftypBytes(), 'video/mp4')).toBe(true);
    expect(bufferMatchesDeclaredMime(ftypBytes(), 'video/quicktime')).toBe(true);
    expect(bufferMatchesDeclaredMime(webmBytes(), 'video/webm')).toBe(true);
    expect(bufferMatchesDeclaredMime(webmBytes(), 'video/mp4')).toBe(false);
    expect(bufferMatchesDeclaredMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'video/mp4')).toBe(
      false,
    );
  });

  it('rejects oversized images and blocked extensions', () => {
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'image/webp',
        bytes: CHAT_IMAGE_MAX_BYTES + 1,
        fileName: 'big.webp',
      }).errorCode,
    ).toBe('too_large');

    expect(
      validateChatAttachmentPolicy({
        mimeType: 'application/pdf',
        bytes: 100,
        fileName: 'malware.exe',
      }).errorCode,
    ).toBe('blocked_extension');

    expect(isBlockedChatAttachmentExtension('html')).toBe(true);
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'application/zip',
        bytes: 10,
        fileName: 'x.zip',
      }).errorCode,
    ).toBe('invalid_type');
  });

  it('sanitizes file names and aligns extension to MIME', () => {
    expect(sanitizeChatAttachmentFileName('../../evil.png', 'image/jpeg')).toBe(
      'evil.jpg',
    );
    expect(sanitizeChatAttachmentFileName('', 'image/png')).toBe('attachment.png');
    expect(sanitizeChatAttachmentFileName('clip.mov', 'video/mp4')).toBe('clip.mp4');
  });
});

describe('isChatAttachmentsEnabled', () => {
  it('defaults off', () => {
    expect(isChatAttachmentsEnabled({})).toBe(false);
    expect(isChatAttachmentsEnabled({ VITE_CHAT_ATTACHMENTS: '' })).toBe(false);
    expect(isChatAttachmentsEnabled({ VITE_CHAT_ATTACHMENTS: '0' })).toBe(false);
  });

  it('enables on explicit truthy values', () => {
    expect(isChatAttachmentsEnabled({ VITE_CHAT_ATTACHMENTS: '1' })).toBe(true);
    expect(isChatAttachmentsEnabled({ VITE_CHAT_ATTACHMENTS: 'true' })).toBe(true);
    expect(isChatAttachmentsEnabled({ VITE_CHAT_ATTACHMENTS: 'on' })).toBe(true);
  });
});
