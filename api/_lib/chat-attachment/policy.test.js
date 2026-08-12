import { describe, expect, it } from 'vitest';
import {
  buildChatAttachmentStoragePath,
  sanitizePathSegment,
  validateChatAttachmentPolicy,
} from './policy.js';

describe('buildChatAttachmentStoragePath', () => {
  it('builds store chat paths under the store id', () => {
    expect(
      buildChatAttachmentStoragePath({
        scope: 'store',
        storeId: 'store-1',
        roomId: '',
        messageKey: 'msg-1',
        fileName: 'photo.jpg',
      }),
    ).toBe('stores/store-1/chat/msg-1/photo.jpg');
  });

  it('builds group paths without requiring a store id', () => {
    expect(
      buildChatAttachmentStoragePath({
        scope: 'group',
        storeId: '',
        roomId: 'room-abc',
        messageKey: 'msg-2',
        fileName: 'doc.pdf',
      }),
    ).toBe('stores/group-chat/room-abc/msg-2/doc.pdf');
  });
});

describe('sanitizePathSegment + policy', () => {
  it('rejects empty segments to fallback', () => {
    expect(sanitizePathSegment('', 'fallback')).toBe('fallback');
    expect(sanitizePathSegment('../evil', 'x')).toBe('evil');
  });

  it('rejects blocked types server-side', () => {
    expect(
      validateChatAttachmentPolicy({
        mimeType: 'application/zip',
        bytes: 10,
        fileName: 'x.zip',
      }).ok,
    ).toBe(false);
  });
});
