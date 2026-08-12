import { describe, expect, it } from 'vitest';
import {
  QUICK_MESSAGE_IDS,
  isQuickMessageId,
  quickMessageI18nKey,
} from './quickMessages';
import {
  chatAttachmentPolicyErrorCopy,
  formatChatAttachmentBytes,
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from './chatAttachmentDisplay';

describe('quickMessages', () => {
  it('exposes stable ids and i18n keys', () => {
    expect(QUICK_MESSAGE_IDS).toContain('onMyWay');
    expect(quickMessageI18nKey('onMyWay')).toBe('quickMsgOnMyWay');
    expect(isQuickMessageId('thanks')).toBe(true);
    expect(isQuickMessageId('nope')).toBe(false);
  });
});

describe('chatAttachmentDisplay', () => {
  it('formats bytes and resolves urls', () => {
    expect(formatChatAttachmentBytes(500)).toBe('500 B');
    expect(formatChatAttachmentBytes(2048)).toMatch(/KB/);
    expect(formatChatAttachmentBytes('1048576')).toMatch(/MB/);
    expect(
      resolveChatAttachmentUrl({
        attachmentUrl: 'https://example.com/a.jpg',
        attachmentFile: { url: 'https://cdn.example.com/a.jpg' },
      }),
    ).toBe('https://cdn.example.com/a.jpg');
  });

  it('detects attachments and maps policy errors', () => {
    expect(
      messageHasChatAttachment({
        attachmentPath: 'stores/x/chat/y/z.jpg',
        attachmentFileId: '',
      }),
    ).toBe(true);
    const sc = {
      attachmentTooLarge: 'too big',
      attachmentInvalidType: 'bad type',
      attachmentBlocked: 'blocked',
      attachmentEmpty: 'empty',
      uploadFailed: 'failed',
    };
    expect(chatAttachmentPolicyErrorCopy('too_large', sc)).toBe('too big');
    expect(chatAttachmentPolicyErrorCopy('blocked_extension', sc)).toBe('blocked');
    expect(chatAttachmentPolicyErrorCopy('unknown', sc)).toBe('failed');
  });
});
