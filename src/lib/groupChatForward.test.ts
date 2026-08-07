import { describe, expect, it } from 'vitest';
import { buildChatForwardDestinations } from './groupChatForward';
import type { GroupChatRoom, Store } from '../types';

function store(partial: Partial<Store> & Pick<Store, 'id' | 'code' | 'name'>): Store {
  return {
    address: '',
    area: '',
    lat: 0,
    lng: 0,
    geofenceRadiusM: 100,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

function room(partial: Partial<GroupChatRoom> & Pick<GroupChatRoom, 'id' | 'name'>): GroupChatRoom {
  return {
    description: '',
    icon: '',
    privacy: 'private',
    status: 'active',
    createdByUserId: '',
    createdByProfileId: '',
    createdAt: '',
    updatedAt: '',
    lastMessageAt: '',
    similarNameKey: '',
    ...partial,
  };
}

describe('buildChatForwardDestinations', () => {
  it('includes authorized active stores and other groups, excluding current room', () => {
    const destinations = buildChatForwardDestinations({
      authorizedStores: [
        store({ id: 's1', code: 'A1', name: 'Alpha' }),
        store({ id: 's2', code: 'B2', name: 'Beta', active: false }),
      ],
      groupRooms: [
        room({ id: 'g1', name: 'Ops' }),
        room({ id: 'g2', name: 'Night', status: 'archived' }),
        room({ id: 'g3', name: 'Floor' }),
      ],
      excludeGroupRoomId: 'g1',
    });

    expect(destinations).toEqual([
      { kind: 'store', id: 's1', label: 'A1 · Alpha' },
      { kind: 'group', id: 'g3', label: 'Floor' },
    ]);
  });

  it('can exclude a store when forwarding from store chat', () => {
    const destinations = buildChatForwardDestinations({
      authorizedStores: [
        store({ id: 's1', code: 'A1', name: 'Alpha' }),
        store({ id: 's2', code: 'B2', name: 'Beta' }),
      ],
      groupRooms: [room({ id: 'g1', name: 'Ops' })],
      excludeStoreId: 's1',
    });

    expect(destinations.map((d) => `${d.kind}:${d.id}`)).toEqual(['store:s2', 'group:g1']);
  });
});
