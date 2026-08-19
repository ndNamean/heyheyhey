import { describe, expect, it, vi } from 'vitest';

const notifUpdates: Record<string, unknown>[] = [];

vi.mock('../db', () => ({
  db: {
    tx: {
      notifications: new Proxy(
        {},
        {
          get: () => ({
            update: (value: Record<string, unknown>) => {
              notifUpdates.push(value);
              return { __ops: [['update', 'notifications', 'n1', value]] };
            },
          }),
        },
      ),
    },
  },
}));

vi.mock('@instantdb/react', () => ({ id: () => 'n1' }));
vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return { ...actual, nowIso: () => '2026-08-19T00:00:00.000Z' };
});

import { buildGroupChatMentionNotifications } from './notifications';
import { expandMentionRecipients } from './storeChatMentions';

const actor = {
  id: 'p-actor',
  userId: 'u-actor',
  role: 'leader',
  displayName: 'Ada',
  email: 'ada@ex.com',
} as const;

describe('group chat mention storeId', () => {
  it('sets storeId for leadership rooms and keeps private groups empty', () => {
    notifUpdates.length = 0;
    buildGroupChatMentionNotifications({
      messageId: 'm1',
      roomId: 'lead-1',
      roomName: 'Store Operations Leadership Team - PKB',
      body: 'hello @Bob',
      actor: actor as never,
      recipientUserIds: ['u-bob'],
      mentionAll: false,
      storeId: 's-pkb',
    });
    expect(notifUpdates[0]?.storeId).toBe('s-pkb');

    notifUpdates.length = 0;
    buildGroupChatMentionNotifications({
      messageId: 'm2',
      roomId: 'g-private',
      roomName: 'Ops huddle',
      body: 'hello @Bob',
      actor: actor as never,
      recipientUserIds: ['u-bob'],
      mentionAll: false,
    });
    expect(notifUpdates[0]?.storeId).toBe('');
  });

  it('expands @all to this room’s members and writes no inbox without mentions', () => {
    const candidates = [
      { userId: 'u-bob', label: 'Bob', email: 'bob@ex.com', profile: { userId: 'u-bob' } },
      { userId: 'u-cara', label: 'Cara', email: 'cara@ex.com', profile: { userId: 'u-cara' } },
    ];
    expect(expandMentionRecipients([], true, candidates, 'u-actor').sort()).toEqual([
      'u-bob',
      'u-cara',
    ]);
    notifUpdates.length = 0;
    const txs = buildGroupChatMentionNotifications({
      messageId: 'm3',
      roomId: 'lead-1',
      roomName: 'Store Operations Leadership Team - PKB',
      body: 'no mentions',
      actor: actor as never,
      recipientUserIds: [],
      mentionAll: false,
      storeId: 's-pkb',
    });
    expect(txs).toEqual([]);
    expect(notifUpdates).toEqual([]);
  });
});
