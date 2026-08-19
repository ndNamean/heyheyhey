/**
 * Ensure one Operations Leadership room per store (server-derived roster).
 * Called from groupChatEnsureStoreOpsLeadership — ignore client memberIds.
 */

import { id as instantId } from '@instantdb/admin';
import { similarNameKey } from './validation.js';
import {
  STORE_OPS_LEADERSHIP_ROOM_KIND,
  diffLeadershipMembers,
  expectedLeadershipMembers,
  isStoreOpsLeadershipRoom,
  storeOpsLeadershipRoomName,
  unwrapLinked,
} from './store-ops-leadership.js';

function memberDefaults(now) {
  return {
    notificationMode: 'all',
    lastReadAt: now,
    muted: false,
    pinned: false,
  };
}

export function actorMayEnsureStore(actor, storeId, { userHasStoreAccess, canEditMaster, canManageUsers }) {
  if (!storeId) return false;
  if (canEditMaster || canManageUsers) return true;
  return userHasStoreAccess(actor, storeId);
}

export function resolveEnsureStoreIds({
  bodyStoreId,
  bodyProfileId,
  actor,
  stores,
  canEditMaster,
  canManageUsers,
  userHasStoreAccess,
}) {
  const storeId = String(bodyStoreId || '').trim();
  const profileId = String(bodyProfileId || '').trim();

  if (storeId) {
    const target = (stores || []).find((s) => s.id === storeId);
    if (!target) {
      const err = new Error('Store not found');
      err.status = 404;
      throw err;
    }
    if (!actorMayEnsureStore(actor, storeId, { userHasStoreAccess, canEditMaster, canManageUsers })) {
      const err = new Error('Forbidden: store is outside your access');
      err.status = 403;
      throw err;
    }
    return [storeId];
  }

  if (profileId && !canEditMaster && !canManageUsers) {
    const err = new Error('Forbidden: profileId requires canEditMaster or canManageUsers');
    err.status = 403;
    throw err;
  }

  return (stores || [])
    .filter((s) => s && s.id && s.active !== false)
    .filter((s) =>
      actorMayEnsureStore(actor, s.id, { userHasStoreAccess, canEditMaster, canManageUsers }),
    )
    .map((s) => s.id);
}

function logEnsure(payload) {
  console.log('[group-chat] leadership ensure', payload);
}

async function queryStoreWithRoom(adminDb, storeId) {
  const result = await adminDb.query({
    stores: {
      $: { where: { id: storeId } },
      opsLeadershipRoom: { members: {} },
    },
  });
  return result.stores?.[0] ?? null;
}

async function lookupLeadershipRoom(adminDb, storeId) {
  const result = await adminDb.query({
    groupChatRooms: {
      $: {
        where: {
          roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND,
          storeId,
        },
      },
      members: {},
    },
  });
  return result.groupChatRooms?.[0] ?? null;
}

function expectedMemberPayloads(profiles, storeId, defs) {
  return expectedLeadershipMembers(profiles, storeId, defs)
    .filter((p) => p.userId && p.id)
    .map((p) => ({ userId: p.userId, profileId: p.id }));
}

function roomNamePatch(store, now) {
  const name = storeOpsLeadershipRoomName(store.code);
  return {
    name,
    description: name,
    similarNameKey: similarNameKey(name),
    storeId: store.id,
    roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND,
    updatedAt: now,
  };
}

function desiredStatus(store) {
  return store.active === false ? 'archived' : 'active';
}

function buildMemberCreateTxs(adminDb, roomId, toAdd, now, idFn) {
  return toAdd.map((m) =>
    adminDb.tx.groupChatMembers[idFn()]
      .update({
        roomId,
        userId: m.userId,
        profileId: m.profileId,
        roomRole: 'member',
        joinedAt: now,
        ...memberDefaults(now),
      })
      .link({ room: roomId, profile: m.profileId }),
  );
}

/**
 * Ensure one store's leadership room. Returns a summary for tests/logs.
 * Does not write groupChatMessages (no join/leave system rows).
 */
export async function ensureLeadershipRoomForStore({
  adminDb,
  store,
  profiles,
  defs,
  actor,
  now = new Date().toISOString(),
  idFn = instantId,
}) {
  if (!store?.id) {
    return { storeId: '', roomId: '', error: 'missing_store', noOp: true, added: 0, removed: 0, expected: 0, actual: 0 };
  }

  const expected = expectedMemberPayloads(profiles, store.id, defs);
  let room = unwrapLinked(store.opsLeadershipRoom);

  if (!room) {
    const lookup = await lookupLeadershipRoom(adminDb, store.id);
    if (lookup) {
      const nowIso = now;
      await adminDb.transact([
        adminDb.tx.groupChatRooms[lookup.id]
          .update({
            ...roomNamePatch(store, nowIso),
            status: desiredStatus(store),
          })
          .link({ store: store.id }),
      ]);
      const reloaded = await queryStoreWithRoom(adminDb, store.id);
      room = unwrapLinked(reloaded?.opsLeadershipRoom) || lookup;
    }
  }

  if (!room) {
    if (store.active === false) {
      const summary = {
        storeId: store.id,
        roomId: '',
        expected: expected.length,
        actual: 0,
        added: 0,
        removed: 0,
        noOp: true,
        error: null,
      };
      logEnsure(summary);
      return summary;
    }

    const roomId = idFn();
    const createTxs = [
      adminDb.tx.groupChatRooms[roomId]
        .update({
          ...roomNamePatch(store, now),
          icon: '',
          privacy: 'private',
          status: desiredStatus(store),
          createdByUserId: actor?.userId || '',
          createdByProfileId: actor?.profileId || '',
          createdAt: now,
          lastMessageAt: now,
        })
        .link({ store: store.id }),
      ...buildMemberCreateTxs(adminDb, roomId, expected, now, idFn),
    ];
    await adminDb.transact(createTxs);

    const reloaded = await queryStoreWithRoom(adminDb, store.id);
    const linked = unwrapLinked(reloaded?.opsLeadershipRoom);
    if (linked && linked.id !== roomId) {
      await adminDb.transact([
        adminDb.tx.groupChatRooms[roomId].update({
          status: 'archived',
          updatedAt: now,
        }),
      ]);
      room = linked;
    } else {
      const summary = {
        storeId: store.id,
        roomId,
        expected: expected.length,
        actual: expected.length,
        added: expected.length,
        removed: 0,
        noOp: false,
        error: null,
      };
      logEnsure(summary);
      return summary;
    }
  }

  const members = room.members || [];
  const diff = diffLeadershipMembers(expected, members);
  const status = desiredStatus(store);
  const namePatch = roomNamePatch(store, now);
  const needsMeta =
    room.status !== status ||
    room.name !== namePatch.name ||
    room.description !== namePatch.description ||
    room.similarNameKey !== namePatch.similarNameKey ||
    room.storeId !== store.id ||
    !isStoreOpsLeadershipRoom(room);

  if (diff.noOp && !needsMeta) {
    const summary = {
      storeId: store.id,
      roomId: room.id,
      expected: expected.length,
      actual: members.length,
      added: 0,
      removed: 0,
      noOp: true,
      error: null,
    };
    logEnsure(summary);
    return summary;
  }

  const txs = [];
  if (needsMeta) {
    txs.push(
      adminDb.tx.groupChatRooms[room.id].update({
        ...namePatch,
        status,
      }),
    );
  }
  for (const add of diff.toAdd) {
    txs.push(...buildMemberCreateTxs(adminDb, room.id, [add], now, idFn));
  }
  for (const remove of diff.toRemove) {
    if (remove.id) txs.push(adminDb.tx.groupChatMembers[remove.id].delete());
  }
  if (txs.length) await adminDb.transact(txs);

  const summary = {
    storeId: store.id,
    roomId: room.id,
    expected: expected.length,
    actual: members.length,
    added: diff.toAdd.length,
    removed: diff.toRemove.length,
    noOp: diff.noOp && !needsMeta,
    error: null,
  };
  logEnsure(summary);
  return summary;
}

export async function loadEnsureContext(adminDb) {
  const result = await adminDb.query({
    stores: { opsLeadershipRoom: { members: {} } },
    profiles: { stores: {}, roleDefinition: {} },
    roleDefinitions: {},
  });
  return {
    stores: result.stores ?? [],
    profiles: result.profiles ?? [],
    roleDefinitions: result.roleDefinitions ?? [],
  };
}

export { queryStoreWithRoom };
