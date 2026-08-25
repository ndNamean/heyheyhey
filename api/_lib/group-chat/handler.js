/**
 * Custom Group Chat Admin SDK handlers.
 * Mounted from api/invites.js (Hobby function budget — do not add a new Vercel function).
 *
 * Actions: groupChatCreate | groupChatInvite | groupChatAccept | groupChatDecline |
 *          groupChatCancel | groupChatRemind | groupChatArchive | groupChatRename |
 *          groupChatRemoveMember | groupChatLeave | groupChatListPending |
 *          groupChatEnsureStoreOpsLeadership
 */

import { id } from '@instantdb/admin';
import { getAdminDb, parseBody } from '../export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../export/auth.js';
import { isGroupChatEnabled } from './flag.js';
import { isStoreOpsLeadershipChatEnabled } from './leadership-flag.js';
import {
  validateGroupChatName,
  normalizeGroupChatDescription,
  similarNameKey,
} from './validation.js';
import {
  roleCanCreateGroupChat,
  roleCanCreateCrossStoreGroupChat,
  assertInviteeEligible,
  memberIsRoomOwnerOrAdmin,
} from './capabilities.js';
import {
  INVITE_TTL_MS,
  evaluateRemindInviteGuards,
  inviteRemindDeliveryKey,
  nextInviteExpiresAt,
} from './remind.js';
import { appendUnreadCountIncrementTxs } from '../notifications/unread-count.js';
import {
  isReservedStoreOpsLeadershipSimilarNameKey,
  leadershipLifecycleForbidden,
} from './store-ops-leadership.js';
import {
  ensureLeadershipRoomForStore,
  loadEnsureContext,
  resolveEnsureStoreIds,
} from './ensure-store-ops-leadership.js';
import { roleCanManageUsers } from '../export/role-capabilities.js';
import { roleCanEditMaster, userHasStoreAccess } from '../wifi-notify/access.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function transactWithUnreadBump(adminDb, txs) {
  if (!txs?.length) return;
  const bumps = await appendUnreadCountIncrementTxs(adminDb, txs);
  await adminDb.transact([...txs, ...bumps]);
}

async function requireApprovedUser(req) {
  if (!isGroupChatEnabled()) {
    throw httpError(404, 'Group chat is disabled');
  }
  const { userId, email } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  return { ...ctx, email: email || ctx.email };
}

async function requireLeadershipChatUser(req) {
  if (!isStoreOpsLeadershipChatEnabled()) {
    throw httpError(404, 'Operations leadership chat is disabled');
  }
  const { userId, email } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  return { ...ctx, email: email || ctx.email };
}

function assertNotLeadershipLifecycle(room) {
  if (leadershipLifecycleForbidden(room)) {
    throw httpError(403, 'Forbidden: operations leadership room is system-managed');
  }
}

async function loadInviteRoom(adminDb, invite) {
  if (!invite) return null;
  const linked = Array.isArray(invite.room) ? invite.room[0] : invite.room;
  if (linked) return linked;
  if (!invite.roomId) return null;
  return loadRoomWithMembers(adminDb, invite.roomId);
}

function emptyMessageSystemFields() {
  return {
    editedAt: '',
    deletedAt: '',
    status: 'active',
    replyToMessageId: '',
    mentionedUserIdsJson: '[]',
    mentionAll: false,
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    giphyWidth: '',
    giphyHeight: '',
    giphyUrl: '',
    giphyPreviewUrl: '',
    attachmentKind: '',
    attachmentPath: '',
    attachmentFileId: '',
    attachmentUrl: '',
    attachmentMimeType: '',
    attachmentFileName: '',
    attachmentBytes: '',
    attachmentWidth: '',
    attachmentHeight: '',
    forwardedFromMessageId: '',
    forwardedFromUserId: '',
    clientMutationId: '',
  };
}

function memberDefaults(now) {
  return {
    notificationMode: 'all',
    lastReadAt: now,
    muted: false,
    pinned: false,
  };
}

async function loadRoomWithMembers(adminDb, roomId) {
  const result = await adminDb.query({
    groupChatRooms: {
      $: { where: { id: roomId } },
      members: {},
      invites: {},
    },
  });
  return result.groupChatRooms?.[0] ?? null;
}

async function findActorMembership(adminDb, roomId, userId) {
  const result = await adminDb.query({
    groupChatMembers: {
      $: { where: { roomId, userId } },
    },
  });
  return result.groupChatMembers?.[0] ?? null;
}

function buildInviteNotification({
  inviteId,
  roomId,
  roomName,
  actor,
  inviteeUserId,
  now,
  deliveryKey,
  body,
}) {
  return {
    recipientUserId: inviteeUserId,
    type: 'group_chat_invite',
    reportId: '',
    reportResponseId: '',
    storeId: '',
    title: 'Group chat invitation',
    body:
      body ||
      `${actor.displayName || actor.email || 'Someone'} invited you to “${roomName}”. Full history is visible after you accept.`,
    itemTitle: roomName,
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: 'pending',
    actorUserId: actor.userId,
    actorRole: actor.role || '',
    readAt: '',
    createdAt: now,
    deliveryKey: deliveryKey || `group-chat-invite:${inviteId}`,
    deepLinkJson: JSON.stringify({ kind: 'groupChatInvite', inviteId, roomId }),
  };
}

async function createRoom(req, res) {
  const ctx = await requireApprovedUser(req);
  if (!roleCanCreateGroupChat(ctx)) {
    throw httpError(403, 'Forbidden: canCreateGroupChat required');
  }

  const body = parseBody(req.body) || {};
  const nameCheck = validateGroupChatName(body.name);
  if (!nameCheck.ok) {
    return res.status(400).json({ error: `Invalid name: ${nameCheck.error}` });
  }
  if (isReservedStoreOpsLeadershipSimilarNameKey(similarNameKey(nameCheck.name))) {
    return res.status(400).json({ error: 'Name is reserved for operations leadership rooms' });
  }
  const description = normalizeGroupChatDescription(body.description);
  const icon = String(body.icon ?? '').trim().slice(0, 64);
  const inviteeProfileIds = Array.isArray(body.inviteeProfileIds)
    ? [...new Set(body.inviteeProfileIds.map((x) => String(x).trim()).filter(Boolean))]
    : [];

  const canCross = roleCanCreateCrossStoreGroupChat(ctx);
  const adminDb = getAdminDb();
  const now = new Date().toISOString();
  const roomId = id();
  const memberId = id();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const inviteeProfiles = [];
  if (inviteeProfileIds.length) {
    const q = await adminDb.query({
      profiles: {
        $: { where: { id: { $in: inviteeProfileIds } } },
        stores: {},
      },
    });
    const byId = new Map((q.profiles || []).map((p) => [p.id, p]));
    for (const pid of inviteeProfileIds) {
      const p = byId.get(pid);
      if (!p) throw httpError(400, `Unknown invitee profile: ${pid}`);
      const err = assertInviteeEligible(ctx, p, canCross);
      if (err) throw httpError(403, err);
      inviteeProfiles.push(p);
    }
  }

  const txs = [
    adminDb.tx.groupChatRooms[roomId].update({
      name: nameCheck.name,
      description,
      icon,
      privacy: 'private',
      status: 'active',
      createdByUserId: ctx.userId,
      createdByProfileId: ctx.profileId,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      similarNameKey: similarNameKey(nameCheck.name),
      roomKind: '',
      storeId: '',
    }),
    adminDb.tx.groupChatMembers[memberId]
      .update({
        roomId,
        userId: ctx.userId,
        profileId: ctx.profileId,
        roomRole: 'owner',
        joinedAt: now,
        ...memberDefaults(now),
      })
      .link({ room: roomId, profile: ctx.profileId }),
  ];

  const systemMsgId = id();
  txs.push(
    adminDb.tx.groupChatMessages[systemMsgId]
      .update({
        roomId,
        senderUserId: ctx.userId,
        senderProfileId: ctx.profileId,
        senderNameSnapshot: ctx.displayName || ctx.email || 'System',
        senderRoleSnapshot: ctx.role || '',
        messageType: 'system',
        body: `${ctx.displayName || 'Someone'} created this private group. Full history is visible to members after they accept an invite.`,
        createdAt: now,
        ...emptyMessageSystemFields(),
        clientMutationId: id(),
      })
      .link({ room: roomId, sender: ctx.profileId }),
  );

  const invitesOut = [];
  for (const p of inviteeProfiles) {
    const inviteId = id();
    invitesOut.push({ inviteId, inviteeProfileId: p.id, inviteeUserId: p.userId });
    txs.push(
      adminDb.tx.groupChatInvites[inviteId]
        .update({
          roomId,
          inviteeUserId: p.userId,
          inviteeProfileId: p.id,
          inviterUserId: ctx.userId,
          inviterProfileId: ctx.profileId,
          status: 'pending',
          historyMode: 'full',
          roomNameSnapshot: nameCheck.name,
          roomDescriptionSnapshot: description,
          inviterNameSnapshot: ctx.displayName || ctx.email || '',
          createdAt: now,
          respondedAt: '',
          expiresAt,
        })
        .link({ room: roomId, invitee: p.id, inviter: ctx.profileId }),
    );
    const notifId = id();
    txs.push(
      adminDb.tx.notifications[notifId].update(
        buildInviteNotification({
          inviteId,
          roomId,
          roomName: nameCheck.name,
          actor: ctx,
          inviteeUserId: p.userId,
          now,
        }),
      ),
    );
  }

  await transactWithUnreadBump(adminDb, txs);
  return res.status(200).json({
    ok: true,
    roomId,
    invites: invitesOut,
    historyDisclosure: 'full',
  });
}

async function inviteMembers(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const roomId = String(body.roomId || '').trim();
  const inviteeProfileIds = Array.isArray(body.inviteeProfileIds)
    ? [...new Set(body.inviteeProfileIds.map((x) => String(x).trim()).filter(Boolean))]
    : [];
  if (!roomId || !inviteeProfileIds.length) {
    return res.status(400).json({ error: 'roomId and inviteeProfileIds required' });
  }

  const adminDb = getAdminDb();
  const room = await loadRoomWithMembers(adminDb, roomId);
  if (!room || room.status === 'archived') {
    throw httpError(404, 'Room not found or archived');
  }
  assertNotLeadershipLifecycle(room);
  const actorMember = (room.members || []).find((m) => m.userId === ctx.userId);
  if (!memberIsRoomOwnerOrAdmin(actorMember)) {
    throw httpError(403, 'Forbidden: room owner/admin required');
  }

  const canCross = roleCanCreateCrossStoreGroupChat(ctx);
  const q = await adminDb.query({
    profiles: {
      $: { where: { id: { $in: inviteeProfileIds } } },
      stores: {},
    },
  });
  const byId = new Map((q.profiles || []).map((p) => [p.id, p]));
  const memberUserIds = new Set((room.members || []).map((m) => m.userId));
  const pendingInviteeIds = new Set(
    (room.invites || [])
      .filter((i) => i.status === 'pending')
      .map((i) => i.inviteeProfileId),
  );

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const txs = [];
  const invitesOut = [];

  for (const pid of inviteeProfileIds) {
    if (pendingInviteeIds.has(pid)) continue;
    const p = byId.get(pid);
    if (!p) throw httpError(400, `Unknown invitee profile: ${pid}`);
    if (memberUserIds.has(p.userId)) continue;
    const err = assertInviteeEligible(ctx, p, canCross);
    if (err) throw httpError(403, err);

    const inviteId = id();
    invitesOut.push({ inviteId, inviteeProfileId: p.id, inviteeUserId: p.userId });
    txs.push(
      adminDb.tx.groupChatInvites[inviteId]
        .update({
          roomId,
          inviteeUserId: p.userId,
          inviteeProfileId: p.id,
          inviterUserId: ctx.userId,
          inviterProfileId: ctx.profileId,
          status: 'pending',
          historyMode: 'full',
          roomNameSnapshot: room.name,
          roomDescriptionSnapshot: room.description || '',
          inviterNameSnapshot: ctx.displayName || ctx.email || '',
          createdAt: now,
          respondedAt: '',
          expiresAt,
        })
        .link({ room: roomId, invitee: p.id, inviter: ctx.profileId }),
    );
    txs.push(
      adminDb.tx.notifications[id()].update(
        buildInviteNotification({
          inviteId,
          roomId,
          roomName: room.name,
          actor: ctx,
          inviteeUserId: p.userId,
          now,
        }),
      ),
    );
  }

  if (txs.length) await transactWithUnreadBump(adminDb, txs);
  return res.status(200).json({ ok: true, invites: invitesOut, historyDisclosure: 'full' });
}

async function acceptInvite(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const inviteId = String(body.inviteId || '').trim();
  if (!inviteId) return res.status(400).json({ error: 'inviteId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    groupChatInvites: {
      $: { where: { id: inviteId } },
      room: {},
    },
  });
  const invite = result.groupChatInvites?.[0];
  if (!invite || invite.inviteeUserId !== ctx.userId) {
    throw httpError(404, 'Invite not found');
  }
  if (invite.status !== 'pending') {
    throw httpError(400, `Invite is ${invite.status}`);
  }
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) {
    await adminDb.transact([
      adminDb.tx.groupChatInvites[inviteId].update({
        status: 'expired',
        respondedAt: new Date().toISOString(),
      }),
    ]);
    throw httpError(400, 'Invite expired');
  }

  const room = Array.isArray(invite.room) ? invite.room[0] : invite.room;
  if (!room || room.status === 'archived') {
    throw httpError(400, 'Room unavailable');
  }
  assertNotLeadershipLifecycle(room);

  const now = new Date().toISOString();
  const memberId = id();
  await adminDb.transact([
    adminDb.tx.groupChatInvites[inviteId].update({
      status: 'accepted',
      respondedAt: now,
    }),
    adminDb.tx.groupChatMembers[memberId]
      .update({
        roomId: invite.roomId,
        userId: ctx.userId,
        profileId: ctx.profileId,
        roomRole: 'member',
        joinedAt: now,
        ...memberDefaults(now),
      })
      .link({ room: invite.roomId, profile: ctx.profileId }),
    adminDb.tx.groupChatMessages[id()]
      .update({
        roomId: invite.roomId,
        senderUserId: ctx.userId,
        senderProfileId: ctx.profileId,
        senderNameSnapshot: ctx.displayName || ctx.email || 'Member',
        senderRoleSnapshot: ctx.role || '',
        messageType: 'system',
        body: `${ctx.displayName || 'Someone'} joined the group.`,
        createdAt: now,
        ...emptyMessageSystemFields(),
        clientMutationId: id(),
      })
      .link({ room: invite.roomId, sender: ctx.profileId }),
  ]);

  return res.status(200).json({
    ok: true,
    roomId: invite.roomId,
    historyDisclosure: 'full',
  });
}

async function declineInvite(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const inviteId = String(body.inviteId || '').trim();
  if (!inviteId) return res.status(400).json({ error: 'inviteId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    groupChatInvites: { $: { where: { id: inviteId } }, room: {} },
  });
  const invite = result.groupChatInvites?.[0];
  if (!invite || invite.inviteeUserId !== ctx.userId) {
    throw httpError(404, 'Invite not found');
  }
  if (invite.status !== 'pending') {
    throw httpError(400, `Invite is ${invite.status}`);
  }
  const room = await loadInviteRoom(adminDb, invite);
  assertNotLeadershipLifecycle(room);
  const now = new Date().toISOString();
  await adminDb.transact([
    adminDb.tx.groupChatInvites[inviteId].update({
      status: 'declined',
      respondedAt: now,
    }),
  ]);
  return res.status(200).json({ ok: true });
}

async function cancelInvite(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const inviteId = String(body.inviteId || '').trim();
  if (!inviteId) return res.status(400).json({ error: 'inviteId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    groupChatInvites: { $: { where: { id: inviteId } }, room: {} },
  });
  const invite = result.groupChatInvites?.[0];
  if (!invite) throw httpError(404, 'Invite not found');
  if (invite.status !== 'pending') {
    throw httpError(400, `Invite is ${invite.status}`);
  }
  const room = await loadInviteRoom(adminDb, invite);
  assertNotLeadershipLifecycle(room);

  const membership = await findActorMembership(adminDb, invite.roomId, ctx.userId);
  const canCancel =
    invite.inviterUserId === ctx.userId || memberIsRoomOwnerOrAdmin(membership);
  if (!canCancel) throw httpError(403, 'Forbidden');

  await adminDb.transact([
    adminDb.tx.groupChatInvites[inviteId].update({
      status: 'cancelled',
      respondedAt: new Date().toISOString(),
    }),
  ]);
  return res.status(200).json({ ok: true });
}

async function remindInvite(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const inviteId = String(body.inviteId || '').trim();
  if (!inviteId) return res.status(400).json({ error: 'inviteId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    groupChatInvites: {
      $: { where: { id: inviteId } },
      room: {},
    },
  });
  const invite = result.groupChatInvites?.[0];
  const membership = invite
    ? await findActorMembership(adminDb, invite.roomId, ctx.userId)
    : null;
  const nowIso = new Date().toISOString();
  const guard = evaluateRemindInviteGuards({
    invite,
    actorUserId: ctx.userId,
    membership,
    nowIso,
  });
  if (!guard.ok) throw httpError(guard.status, guard.error);

  const room = Array.isArray(invite.room) ? invite.room[0] : invite.room;
  assertNotLeadershipLifecycle(room);
  const roomName = room?.name || invite.roomNameSnapshot || 'group chat';
  const nowMs = Date.now();
  const expiresAt = nextInviteExpiresAt(nowMs);

  await transactWithUnreadBump(adminDb, [
    adminDb.tx.groupChatInvites[inviteId].update({ expiresAt }),
    adminDb.tx.notifications[id()].update(
      buildInviteNotification({
        inviteId,
        roomId: invite.roomId,
        roomName,
        actor: ctx,
        inviteeUserId: invite.inviteeUserId,
        now: nowIso,
        deliveryKey: inviteRemindDeliveryKey(inviteId, nowMs),
        body: `${ctx.displayName || ctx.email || 'Someone'} reminded you about “${roomName}”. The invite is still pending.`,
      }),
    ),
  ]);

  return res.status(200).json({ ok: true, expiresAt });
}

async function archiveRoom(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const roomId = String(body.roomId || '').trim();
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  const adminDb = getAdminDb();
  const room = await loadRoomWithMembers(adminDb, roomId);
  if (!room) throw httpError(404, 'Room not found');
  assertNotLeadershipLifecycle(room);
  const membership = await findActorMembership(adminDb, roomId, ctx.userId);
  if (!membership || membership.roomRole !== 'owner') {
    throw httpError(403, 'Forbidden: room owner required');
  }
  const now = new Date().toISOString();
  await adminDb.transact([
    adminDb.tx.groupChatRooms[roomId].update({
      status: 'archived',
      updatedAt: now,
    }),
  ]);
  return res.status(200).json({ ok: true });
}

async function renameRoom(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const roomId = String(body.roomId || '').trim();
  const nameCheck = validateGroupChatName(body.name);
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  if (!nameCheck.ok) return res.status(400).json({ error: `Invalid name: ${nameCheck.error}` });
  if (isReservedStoreOpsLeadershipSimilarNameKey(similarNameKey(nameCheck.name))) {
    return res.status(400).json({ error: 'Name is reserved for operations leadership rooms' });
  }

  const adminDb = getAdminDb();
  const room = await loadRoomWithMembers(adminDb, roomId);
  if (!room) throw httpError(404, 'Room not found');
  assertNotLeadershipLifecycle(room);
  const membership = await findActorMembership(adminDb, roomId, ctx.userId);
  if (!memberIsRoomOwnerOrAdmin(membership)) {
    throw httpError(403, 'Forbidden: room owner/admin required');
  }
  const description =
    body.description !== undefined
      ? normalizeGroupChatDescription(body.description)
      : undefined;
  const now = new Date().toISOString();
  const patch = {
    name: nameCheck.name,
    similarNameKey: similarNameKey(nameCheck.name),
    updatedAt: now,
  };
  if (description !== undefined) patch.description = description;
  await adminDb.transact([adminDb.tx.groupChatRooms[roomId].update(patch)]);
  return res.status(200).json({ ok: true });
}

async function removeMember(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const roomId = String(body.roomId || '').trim();
  const targetUserId = String(body.targetUserId || '').trim();
  if (!roomId || !targetUserId) {
    return res.status(400).json({ error: 'roomId and targetUserId required' });
  }

  const adminDb = getAdminDb();
  const room = await loadRoomWithMembers(adminDb, roomId);
  if (!room) throw httpError(404, 'Room not found');
  assertNotLeadershipLifecycle(room);
  const actorMember = (room.members || []).find((m) => m.userId === ctx.userId);
  if (!memberIsRoomOwnerOrAdmin(actorMember)) {
    throw httpError(403, 'Forbidden');
  }
  const target = (room.members || []).find((m) => m.userId === targetUserId);
  if (!target) throw httpError(404, 'Member not found');
  if (target.roomRole === 'owner') {
    throw httpError(403, 'Cannot remove room owner');
  }
  if (target.roomRole === 'admin' && actorMember.roomRole !== 'owner') {
    throw httpError(403, 'Only owner may remove an admin');
  }

  await adminDb.transact([adminDb.tx.groupChatMembers[target.id].delete()]);
  return res.status(200).json({ ok: true });
}

async function leaveRoom(req, res) {
  const ctx = await requireApprovedUser(req);
  const body = parseBody(req.body) || {};
  const roomId = String(body.roomId || '').trim();
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  const adminDb = getAdminDb();
  const room = await loadRoomWithMembers(adminDb, roomId);
  if (!room) throw httpError(404, 'Room not found');
  assertNotLeadershipLifecycle(room);
  const membership = await findActorMembership(adminDb, roomId, ctx.userId);
  if (!membership) throw httpError(404, 'Not a member');
  if (membership.roomRole === 'owner') {
    throw httpError(400, 'Owner must transfer ownership or archive before leaving');
  }
  await adminDb.transact([adminDb.tx.groupChatMembers[membership.id].delete()]);
  return res.status(200).json({ ok: true });
}

async function listPending(req, res) {
  const ctx = await requireApprovedUser(req);
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    groupChatInvites: {
      $: { where: { inviteeUserId: ctx.userId, status: 'pending' } },
      room: {},
      inviter: {},
    },
  });
  const invites = (result.groupChatInvites || []).map((inv) => {
    const room = Array.isArray(inv.room) ? inv.room[0] : inv.room;
    const inviter = Array.isArray(inv.inviter) ? inv.inviter[0] : inv.inviter;
    return {
      id: inv.id,
      roomId: inv.roomId,
      status: inv.status,
      historyMode: inv.historyMode || 'full',
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      room: room
        ? { id: room.id, name: room.name, description: room.description, icon: room.icon }
        : null,
      inviter: inviter
        ? {
            id: inviter.id,
            displayName: inviter.displayName,
            email: inviter.email,
          }
        : null,
    };
  });
  return res.status(200).json({ ok: true, invites, historyDisclosure: 'full' });
}

async function ensureStoreOpsLeadership(req, res) {
  const ctx = await requireLeadershipChatUser(req);
  const body = parseBody(req.body) || {};
  // Server-derived roster only — ignore client memberIds / ranks.
  void body.memberIds;
  void body.ranks;

  const adminDb = getAdminDb();
  const { stores, profiles, roleDefinitions } = await loadEnsureContext(adminDb);
  const canEditMaster = roleCanEditMaster(ctx.role, ctx.roleDefinition, ctx.roleDefinitions);
  const canManageUsers = roleCanManageUsers(ctx.role, ctx.roleDefinition);
  const storeIds = resolveEnsureStoreIds({
    bodyStoreId: body.storeId,
    bodyProfileId: body.profileId,
    actor: ctx,
    stores,
    canEditMaster,
    canManageUsers,
    userHasStoreAccess,
  });

  const results = [];
  for (const storeId of storeIds) {
    const store = stores.find((s) => s.id === storeId);
    if (!store) continue;
    try {
      const summary = await ensureLeadershipRoomForStore({
        adminDb,
        store,
        profiles,
        defs: roleDefinitions,
        actor: ctx,
      });
      results.push(summary);
    } catch (e) {
      console.error('[group-chat] leadership ensure', {
        storeId,
        roomId: '',
        expected: 0,
        actual: 0,
        added: 0,
        removed: 0,
        noOp: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  return res.status(200).json({ ok: true, results });
}

export async function handleGroupChatRequest(req, res) {
  const action = String(req.query?.action || req.body?.action || '').trim();

  try {
    if (req.method === 'POST' && action === 'groupChatCreate') {
      return await createRoom(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatInvite') {
      return await inviteMembers(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatAccept') {
      return await acceptInvite(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatDecline') {
      return await declineInvite(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatCancel') {
      return await cancelInvite(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatRemind') {
      return await remindInvite(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatArchive') {
      return await archiveRoom(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatRename') {
      return await renameRoom(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatRemoveMember') {
      return await removeMember(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatLeave') {
      return await leaveRoom(req, res);
    }
    if (req.method === 'POST' && action === 'groupChatEnsureStoreOpsLeadership') {
      return await ensureStoreOpsLeadership(req, res);
    }
    if (
      (req.method === 'GET' || req.method === 'POST') &&
      action === 'groupChatListPending'
    ) {
      return await listPending(req, res);
    }

    return res.status(400).json({ error: 'Unknown group chat action' });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[group-chat]', action, e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Group chat request failed',
    });
  }
}

export function isGroupChatAction(action) {
  return String(action || '').startsWith('groupChat');
}
