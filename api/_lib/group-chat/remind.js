/**
 * Pure helpers for Admin `groupChatRemind` (re-notify without duplicating invite rows).
 */

import { memberIsRoomOwnerOrAdmin } from './capabilities.js';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function inviteRemindDeliveryKey(inviteId, timestamp) {
  return `group-chat-invite:${inviteId}:remind:${timestamp}`;
}

export function nextInviteExpiresAt(nowMs = Date.now()) {
  return new Date(nowMs + INVITE_TTL_MS).toISOString();
}

export function canActorRemindInvite(actorUserId, invite, membership) {
  if (!actorUserId || !invite) return false;
  if (invite.inviterUserId === actorUserId) return true;
  return Boolean(memberIsRoomOwnerOrAdmin(membership));
}

/**
 * Guard rails for reminding an existing pending invite.
 * Does not create a second invite row.
 *
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function evaluateRemindInviteGuards({ invite, actorUserId, membership, nowIso }) {
  if (!invite) return { ok: false, status: 404, error: 'Invite not found' };
  if (invite.status !== 'pending') {
    return { ok: false, status: 400, error: `Invite is ${invite.status}` };
  }
  const now = nowIso || new Date().toISOString();
  if (invite.expiresAt && invite.expiresAt < now) {
    return { ok: false, status: 400, error: 'Invite expired' };
  }
  if (!canActorRemindInvite(actorUserId, invite, membership)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}
