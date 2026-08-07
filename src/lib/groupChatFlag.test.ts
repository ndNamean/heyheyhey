import { describe, expect, it } from 'vitest';
import { isGroupChatEnabled } from './groupChatFlag';

describe('isGroupChatEnabled', () => {
  it('defaults off', () => {
    expect(isGroupChatEnabled({})).toBe(false);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: '' })).toBe(false);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: '0' })).toBe(false);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: 'false' })).toBe(false);
  });

  it('enables on explicit truthy values', () => {
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: '1' })).toBe(true);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: 'true' })).toBe(true);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: 'on' })).toBe(true);
    expect(isGroupChatEnabled({ VITE_GROUP_CHAT: 'TRUE' })).toBe(true);
  });

  it('accepts server GROUP_CHAT alias', () => {
    expect(isGroupChatEnabled({ GROUP_CHAT: '1' })).toBe(true);
  });
});
