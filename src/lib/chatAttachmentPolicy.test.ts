import { describe, expect, it } from 'vitest';
import {
  CHAT_FILE_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
  chatAttachmentKindForMime,
  isBlockedChatAttachmentExtension,
  sanitizeChatAttachmentFileName,
  validateChatAttachmentPolicy,
} from './chatAttachmentPolicy';
import { isChatAttachmentsEnabled } from './chatAttachmentsFlag';

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
