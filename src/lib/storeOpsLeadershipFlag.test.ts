import { describe, expect, it } from 'vitest';
import {
  isChatsSurfaceEnabled,
  isStoreOpsLeadershipChatEnabled,
  isStoreOpsLeadershipOversightNotifyEnabled,
} from './storeOpsLeadershipFlag';

describe('store ops leadership flags', () => {
  it('defaults both flags off', () => {
    expect(isStoreOpsLeadershipChatEnabled({})).toBe(false);
    expect(isStoreOpsLeadershipOversightNotifyEnabled({})).toBe(false);
    expect(isChatsSurfaceEnabled({})).toBe(false);
  });

  it('enables chat on explicit truthy values', () => {
    expect(isStoreOpsLeadershipChatEnabled({ VITE_STORE_OPS_LEADERSHIP_CHAT: '1' })).toBe(true);
    expect(isStoreOpsLeadershipChatEnabled({ STORE_OPS_LEADERSHIP_CHAT: 'true' })).toBe(true);
    expect(isStoreOpsLeadershipChatEnabled({ VITE_STORE_OPS_LEADERSHIP_CHAT: 'on' })).toBe(true);
  });

  it('enables oversight independently of chat', () => {
    expect(
      isStoreOpsLeadershipOversightNotifyEnabled({
        VITE_STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY: '1',
      }),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipChatEnabled({
        VITE_STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY: '1',
      }),
    ).toBe(false);
  });

  it('turns chats surface on when either group or leadership chat is on', () => {
    expect(isChatsSurfaceEnabled({ VITE_GROUP_CHAT: '1' })).toBe(true);
    expect(isChatsSurfaceEnabled({ VITE_STORE_OPS_LEADERSHIP_CHAT: '1' })).toBe(true);
  });
});
