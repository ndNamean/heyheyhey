import { describe, expect, it } from 'vitest';
import {
  INVITE_TTL_MS,
  canActorRemindInvite,
  evaluateRemindInviteGuards,
  inviteRemindDeliveryKey,
  nextInviteExpiresAt,
} from './remind.js';

const pendingInvite = {
  id: 'inv-1',
  status: 'pending',
  inviterUserId: 'inviter-1',
  expiresAt: '2026-08-20T00:00:00.000Z',
};

const nowIso = '2026-08-11T00:00:00.000Z';

describe('inviteRemindDeliveryKey', () => {
  it('includes invite id, remind, and timestamp so it does not collide with the original', () => {
    expect(inviteRemindDeliveryKey('inv-1', 1710000000000)).toBe(
      'group-chat-invite:inv-1:remind:1710000000000',
    );
    expect(inviteRemindDeliveryKey('inv-1', 1710000000000)).not.toBe(
      'group-chat-invite:inv-1',
    );
  });
});

describe('nextInviteExpiresAt', () => {
  it('extends TTL from now by INVITE_TTL_MS', () => {
    const nowMs = Date.parse('2026-08-11T00:00:00.000Z');
    expect(nextInviteExpiresAt(nowMs)).toBe(
      new Date(nowMs + INVITE_TTL_MS).toISOString(),
    );
  });
});

describe('canActorRemindInvite', () => {
  it('allows room owner/admin or the original inviter', () => {
    expect(canActorRemindInvite('owner-1', pendingInvite, { roomRole: 'owner' })).toBe(
      true,
    );
    expect(canActorRemindInvite('admin-1', pendingInvite, { roomRole: 'admin' })).toBe(
      true,
    );
    expect(canActorRemindInvite('inviter-1', pendingInvite, { roomRole: 'member' })).toBe(
      true,
    );
    expect(canActorRemindInvite('member-1', pendingInvite, { roomRole: 'member' })).toBe(
      false,
    );
    expect(canActorRemindInvite('stranger', pendingInvite, null)).toBe(false);
  });
});

describe('evaluateRemindInviteGuards', () => {
  it('passes for a pending unexpired invite when actor may remind', () => {
    expect(
      evaluateRemindInviteGuards({
        invite: pendingInvite,
        actorUserId: 'owner-1',
        membership: { roomRole: 'owner' },
        nowIso,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects missing, non-pending, expired, and forbidden actors', () => {
    expect(
      evaluateRemindInviteGuards({
        invite: null,
        actorUserId: 'owner-1',
        membership: { roomRole: 'owner' },
        nowIso,
      }),
    ).toEqual({ ok: false, status: 404, error: 'Invite not found' });

    expect(
      evaluateRemindInviteGuards({
        invite: { ...pendingInvite, status: 'accepted' },
        actorUserId: 'owner-1',
        membership: { roomRole: 'owner' },
        nowIso,
      }),
    ).toEqual({ ok: false, status: 400, error: 'Invite is accepted' });

    expect(
      evaluateRemindInviteGuards({
        invite: { ...pendingInvite, expiresAt: '2026-08-01T00:00:00.000Z' },
        actorUserId: 'owner-1',
        membership: { roomRole: 'owner' },
        nowIso,
      }),
    ).toEqual({ ok: false, status: 400, error: 'Invite expired' });

    expect(
      evaluateRemindInviteGuards({
        invite: pendingInvite,
        actorUserId: 'member-1',
        membership: { roomRole: 'member' },
        nowIso,
      }),
    ).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });
});
