import { describe, expect, it } from 'vitest';
import {
  hasStoreAccess,
  recipientsForChatRoom,
  resolveAckChatStoreIds,
} from './ack-chat-rooms.js';
import {
  LOGBOOK_MENTION_CAP,
  chatDeliveryKey,
  selectMentionUserIds,
} from './notification-content.js';

describe('resolveAckChatStoreIds', () => {
  const stores = [
    { id: 's1', active: true },
    { id: 's2', active: true },
    { id: 's3', active: false },
    { id: 's4', active: true },
  ];

  it('returns single entry.storeId when set', () => {
    expect(
      resolveAckChatStoreIds(
        { storeId: 's1' },
        ['u1'],
        [{ userId: 'u1', role: 'staff', stores: [{ id: 's2' }] }],
        stores,
      ),
    ).toEqual(['s1']);
  });

  it('fans out all-store to active rooms recipients can access', () => {
    const profiles = [
      {
        userId: 'u1',
        role: 'staff',
        stores: [{ id: 's1' }, { id: 's3' }],
      },
      {
        userId: 'u2',
        role: 'manager',
        stores: [{ id: 's2' }],
      },
      {
        userId: 'u3',
        role: 'staff',
        stores: [{ id: 's4' }],
      },
    ];
    expect(
      resolveAckChatStoreIds(
        { storeId: '' },
        ['u1', 'u2'],
        profiles,
        stores,
      ),
    ).toEqual(['s1', 's2']);
  });

  it('includes all active stores when an elevated recipient is in the set', () => {
    const profiles = [
      { userId: 'owner1', role: 'owner', stores: [] },
      { userId: 'u1', role: 'staff', stores: [{ id: 's1' }] },
    ];
    expect(
      resolveAckChatStoreIds(
        { storeId: '' },
        ['owner1'],
        profiles,
        stores,
      ),
    ).toEqual(['s1', 's2', 's4']);
  });

  it('returns [] when no recipients or no overlapping active stores', () => {
    expect(resolveAckChatStoreIds({ storeId: '' }, [], [], stores)).toEqual([]);
    expect(
      resolveAckChatStoreIds(
        { storeId: '' },
        ['u1'],
        [{ userId: 'u1', role: 'staff', stores: [{ id: 's3' }] }],
        stores,
      ),
    ).toEqual([]);
  });
});

describe('recipientsForChatRoom + mentions fan-out', () => {
  const profiles = [
    { userId: 'u1', role: 'staff', stores: [{ id: 's1' }] },
    { userId: 'u2', role: 'staff', stores: [{ id: 's1' }, { id: 's2' }] },
    { userId: 'u3', role: 'manager', stores: [{ id: 's2' }] },
  ];
  const recipients = ['u1', 'u2', 'u3'];

  it('filters room mentions to users with store access', () => {
    expect(recipientsForChatRoom(recipients, profiles, 's1')).toEqual([
      'u1',
      'u2',
    ]);
    expect(recipientsForChatRoom(recipients, profiles, 's2')).toEqual([
      'u2',
      'u3',
    ]);
    expect(hasStoreAccess(profiles[2], 's1')).toBe(false);
  });

  it('caps per-room mentions and builds distinct delivery keys', () => {
    const many = Array.from({ length: LOGBOOK_MENTION_CAP + 1 }, (_, i) => `u${i}`);
    const manyProfiles = many.map((userId) => ({
      userId,
      role: 'staff',
      stores: [{ id: 's1' }],
    }));
    const room = recipientsForChatRoom(many, manyProfiles, 's1');
    expect(selectMentionUserIds(room)).toEqual([]);

    expect(chatDeliveryKey('e1', 'ack_required', 'v1', 's1')).toBe(
      'logbook-chat:e1:ack_required:v1:s1',
    );
    expect(chatDeliveryKey('e1', 'ack_required', 'v1', 's2')).toBe(
      'logbook-chat:e1:ack_required:v1:s2',
    );
  });
});
