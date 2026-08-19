import { describe, expect, it } from 'vitest';
import {
  actorMayEnsureStore,
  ensureLeadershipRoomForStore,
  resolveEnsureStoreIds,
} from './ensure-store-ops-leadership.js';
import { STORE_OPS_LEADERSHIP_ROOM_KIND } from './store-ops-leadership.js';

const defs = [
  { key: 'owner', rank: 0, canAccessAllStores: true, active: true },
  { key: 'manager', rank: 3, canAccessAllStores: false, active: true },
  { key: 'subleader', rank: 5, canAccessAllStores: false, active: true },
  { key: 'staff', rank: 7, canAccessAllStores: false, active: true },
];

function chainable(record) {
  const obj = { ...record };
  obj.link = (links) => {
    obj.links = { ...(obj.links || {}), ...links };
    return obj;
  };
  return obj;
}

function createFakeAdmin({ stores = [], rooms = [], members = [] } = {}) {
  const state = {
    stores: stores.map((s) => ({ ...s })),
    rooms: rooms.map((r) => ({ ...r })),
    members: members.map((m) => ({ ...m })),
    messages: [],
  };

  function applyTx(tx) {
    if (!tx || typeof tx !== 'object') return;
    if (tx.op === 'update' && tx.collection === 'groupChatRooms') {
      const existing = state.rooms.find((r) => r.id === tx.entityId);
      if (existing) Object.assign(existing, tx.patch);
      else state.rooms.push({ id: tx.entityId, members: [], ...tx.patch });
      if (tx.links?.store) {
        const store = state.stores.find((s) => s.id === tx.links.store);
        if (store) store.opsLeadershipRoom = state.rooms.find((r) => r.id === tx.entityId);
      }
    }
    if (tx.op === 'update' && tx.collection === 'groupChatMembers') {
      const existing = state.members.find((m) => m.id === tx.entityId);
      if (existing) Object.assign(existing, tx.patch);
      else state.members.push({ id: tx.entityId, ...tx.patch });
      const room = state.rooms.find((r) => r.id === tx.patch.roomId || r.id === tx.links?.room);
      if (room) {
        room.members = state.members.filter((m) => m.roomId === room.id);
      }
    }
    if (tx.op === 'delete' && tx.collection === 'groupChatMembers') {
      state.members = state.members.filter((m) => m.id !== tx.entityId);
      for (const room of state.rooms) {
        room.members = state.members.filter((m) => m.roomId === room.id);
      }
    }
    if (tx.op === 'update' && tx.collection === 'groupChatMessages') {
      state.messages.push({ id: tx.entityId, ...tx.patch });
    }
  }

  const adminDb = {
    state,
    query: async (q) => {
      if (q.stores) {
        const whereId = q.stores.$?.where?.id;
        const rows = whereId
          ? state.stores.filter((s) => s.id === whereId)
          : state.stores;
        return {
          stores: rows.map((s) => ({
            ...s,
            opsLeadershipRoom: s.opsLeadershipRoom
              ? {
                  ...s.opsLeadershipRoom,
                  members: state.members.filter((m) => m.roomId === s.opsLeadershipRoom.id),
                }
              : undefined,
          })),
        };
      }
      if (q.groupChatRooms) {
        const where = q.groupChatRooms.$?.where || {};
        const rows = state.rooms.filter((r) => {
          if (where.roomKind && r.roomKind !== where.roomKind) return false;
          if (where.storeId && r.storeId !== where.storeId) return false;
          if (where.id && r.id !== where.id) return false;
          return true;
        });
        return {
          groupChatRooms: rows.map((r) => ({
            ...r,
            members: state.members.filter((m) => m.roomId === r.id),
          })),
        };
      }
      return {};
    },
    transact: async (txs) => {
      for (const tx of txs) applyTx(tx);
    },
    tx: {
      groupChatRooms: new Proxy(
        {},
        {
          get: (_, entityId) => ({
            update: (patch) =>
              chainable({ op: 'update', collection: 'groupChatRooms', entityId, patch }),
          }),
        },
      ),
      groupChatMembers: new Proxy(
        {},
        {
          get: (_, entityId) => ({
            update: (patch) =>
              chainable({ op: 'update', collection: 'groupChatMembers', entityId, patch }),
            delete: () => ({ op: 'delete', collection: 'groupChatMembers', entityId }),
          }),
        },
      ),
      groupChatMessages: new Proxy(
        {},
        {
          get: (_, entityId) => ({
            update: (patch) =>
              chainable({ op: 'update', collection: 'groupChatMessages', entityId, patch }),
          }),
        },
      ),
    },
  };
  return adminDb;
}

describe('resolveEnsureStoreIds', () => {
  const stores = [
    { id: 's1', active: true },
    { id: 's2', active: true },
    { id: 's3', active: false },
  ];
  const actor = { userId: 'u1', storeIds: ['s1'] };
  const userHasStoreAccess = (ctx, storeId) => (ctx.storeIds || []).includes(storeId);

  it('403s unauthorized storeId and ignores client member ids by never reading them', () => {
    expect(() =>
      resolveEnsureStoreIds({
        bodyStoreId: 's2',
        bodyProfileId: '',
        actor,
        stores,
        canEditMaster: false,
        canManageUsers: false,
        userHasStoreAccess,
      }),
    ).toThrow(/outside your access/);
    expect(
      resolveEnsureStoreIds({
        bodyStoreId: '',
        bodyProfileId: '',
        actor,
        stores,
        canEditMaster: false,
        canManageUsers: false,
        userHasStoreAccess,
      }),
    ).toEqual(['s1']);
  });

  it('allows master-data actors to pass profileId and empty body for all active stores', () => {
    expect(
      resolveEnsureStoreIds({
        bodyStoreId: '',
        bodyProfileId: 'p-other',
        actor,
        stores,
        canEditMaster: true,
        canManageUsers: false,
        userHasStoreAccess,
      }).sort(),
    ).toEqual(['s1', 's2']);
    expect(() =>
      resolveEnsureStoreIds({
        bodyStoreId: '',
        bodyProfileId: 'p-other',
        actor,
        stores,
        canEditMaster: false,
        canManageUsers: false,
        userHasStoreAccess,
      }),
    ).toThrow(/profileId/);
  });

  it('actorMayEnsureStore uses master perms or store access', () => {
    expect(
      actorMayEnsureStore(actor, 's2', {
        userHasStoreAccess,
        canEditMaster: false,
        canManageUsers: false,
      }),
    ).toBe(false);
    expect(
      actorMayEnsureStore(actor, 's2', {
        userHasStoreAccess,
        canEditMaster: true,
        canManageUsers: false,
      }),
    ).toBe(true);
  });
});

describe('ensureLeadershipRoomForStore', () => {
  const store = { id: 's1', code: 'PKB', name: 'PKB', active: true };
  const profiles = [
    {
      id: 'p-sub',
      userId: 'u-sub',
      role: 'subleader',
      approvalStatus: 'approved',
      stores: [{ id: 's1' }],
    },
    {
      id: 'p-staff',
      userId: 'u-staff',
      role: 'staff',
      approvalStatus: 'approved',
      stores: [{ id: 's1' }],
    },
  ];
  const actor = { userId: 'u-owner', profileId: 'p-owner' };
  let seq = 0;
  const idFn = () => `id-${++seq}`;

  it('creates one linked room, no-ops when roster matches, and never writes system messages', async () => {
    seq = 0;
    const adminDb = createFakeAdmin({ stores: [{ ...store }] });
    const first = await ensureLeadershipRoomForStore({
      adminDb,
      store: adminDb.state.stores[0],
      profiles,
      defs,
      actor,
      now: '2026-08-19T00:00:00.000Z',
      idFn,
    });
    expect(first.noOp).toBe(false);
    expect(first.added).toBe(1);
    expect(adminDb.state.rooms).toHaveLength(1);
    expect(adminDb.state.rooms[0].roomKind).toBe(STORE_OPS_LEADERSHIP_ROOM_KIND);
    expect(adminDb.state.rooms[0].storeId).toBe('s1');
    expect(adminDb.state.members.map((m) => m.userId)).toEqual(['u-sub']);
    expect(adminDb.state.members[0].roomRole).toBe('member');
    expect(adminDb.state.messages).toEqual([]);

    const linkedStore = {
      ...adminDb.state.stores[0],
      opsLeadershipRoom: {
        ...adminDb.state.rooms[0],
        members: adminDb.state.members.filter((m) => m.roomId === adminDb.state.rooms[0].id),
      },
    };
    const second = await ensureLeadershipRoomForStore({
      adminDb,
      store: linkedStore,
      profiles,
      defs,
      actor,
      now: '2026-08-19T00:00:01.000Z',
      idFn,
    });
    expect(second.noOp).toBe(true);
    expect(second.roomId).toBe(first.roomId);
    expect(adminDb.state.rooms).toHaveLength(1);
    expect(adminDb.state.messages).toEqual([]);
  });

  it('concurrent create keeps the linked room and archives the extra', async () => {
    seq = 0;
    const winner = {
      id: 'winner',
      roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND,
      storeId: 's1',
      status: 'active',
      members: [],
    };
    const adminDb = createFakeAdmin({ stores: [{ ...store }] });
    const originalTransact = adminDb.transact.bind(adminDb);
    adminDb.transact = async (txs) => {
      await originalTransact(txs);
      const created = txs.find(
        (tx) => tx.collection === 'groupChatRooms' && tx.op === 'update' && tx.links?.store,
      );
      if (created && created.entityId !== 'winner') {
        if (!adminDb.state.rooms.find((r) => r.id === 'winner')) {
          adminDb.state.rooms.push(winner);
        }
        adminDb.state.stores[0].opsLeadershipRoom = winner;
      }
    };

    await ensureLeadershipRoomForStore({
      adminDb,
      store: adminDb.state.stores[0],
      profiles,
      defs,
      actor,
      now: '2026-08-19T00:00:00.000Z',
      idFn,
    });
    const archived = adminDb.state.rooms.find((r) => r.status === 'archived');
    expect(adminDb.state.stores[0].opsLeadershipRoom.id).toBe('winner');
    expect(archived).toBeTruthy();
    expect(archived.id).not.toBe('winner');
  });

  it('archives on inactive store and reactivates the same room id', async () => {
    seq = 0;
    const room = {
      id: 'room-1',
      roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND,
      storeId: 's1',
      status: 'active',
      name: 'Store Operations Leadership Team - PKB',
      description: 'Store Operations Leadership Team - PKB',
      similarNameKey: 'storeoperationsleadershipteampkb',
      members: [{ id: 'm1', userId: 'u-sub', profileId: 'p-sub', roomId: 'room-1' }],
    };
    const adminDb = createFakeAdmin({
      stores: [{ ...store, active: false, opsLeadershipRoom: room }],
      rooms: [room],
      members: room.members,
    });
    const archived = await ensureLeadershipRoomForStore({
      adminDb,
      store: { ...store, active: false, opsLeadershipRoom: room },
      profiles,
      defs,
      actor,
      now: '2026-08-19T00:00:00.000Z',
      idFn,
    });
    expect(archived.roomId).toBe('room-1');
    expect(adminDb.state.rooms[0].status).toBe('archived');

    const reactivated = await ensureLeadershipRoomForStore({
      adminDb,
      store: {
        ...store,
        active: true,
        opsLeadershipRoom: { ...adminDb.state.rooms[0], members: adminDb.state.members },
      },
      profiles,
      defs,
      actor,
      now: '2026-08-19T00:00:02.000Z',
      idFn,
    });
    expect(reactivated.roomId).toBe('room-1');
    expect(adminDb.state.rooms[0].status).toBe('active');
  });
});
