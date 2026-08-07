import { describe, expect, it } from 'vitest';
import {
  validateGroupChatName,
  similarNameKey,
  normalizeGroupChatDescription,
} from './groupChatValidation';
import {
  parseChatRoomKey,
  toChatRoomKey,
  migrateSelectedChatRoomKey,
} from './chatRoomKeys';

describe('groupChatValidation', () => {
  it('accepts normal names', () => {
    expect(validateGroupChatName('  Ops huddle  ')).toEqual({
      ok: true,
      name: 'Ops huddle',
    });
  });

  it('rejects empty, symbol-only, urls', () => {
    expect(validateGroupChatName('   ').ok).toBe(false);
    expect(validateGroupChatName('!!!').ok).toBe(false);
    expect(validateGroupChatName('see https://evil.com').ok).toBe(false);
  });

  it('builds similarNameKey', () => {
    expect(similarNameKey('Ops Huddle!')).toBe('opshuddle');
  });

  it('trims description', () => {
    expect(normalizeGroupChatDescription('  hi  ')).toBe('hi');
  });
});

describe('chatRoomKeys', () => {
  it('round-trips keys', () => {
    expect(toChatRoomKey({ kind: 'group', id: 'r1' })).toBe('group:r1');
    expect(parseChatRoomKey('store:s1')).toEqual({ kind: 'store', id: 's1' });
  });

  it('migrates legacy store selection', () => {
    expect(migrateSelectedChatRoomKey('s9', null)).toEqual({
      kind: 'store',
      id: 's9',
    });
    expect(migrateSelectedChatRoomKey('s9', 'group:g1')).toEqual({
      kind: 'group',
      id: 'g1',
    });
  });
});
