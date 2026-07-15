/**
 * Opaque-token invitations API.
 * Actions: create | validate | accept | resend | revoke | list
 */

import { id } from '@instantdb/admin';
import { getAdminDb, parseBody } from './_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from './_lib/export/auth.js';
import { getAppOrigin } from './_lib/magic-code-email.js';
import { sendInviteEmail } from './_lib/invite-email.js';
import {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  maskEmail,
  parseStoreIdsJson,
  isExpired,
} from './_lib/invite-crypto.js';

const OWNER_ONLY_ROLES = new Set(['owner', 'areaManager']);

function canManageUsers(role, roleDefinition) {
  if (roleDefinition && typeof roleDefinition.canManageUsers === 'boolean') {
    return !!roleDefinition.canManageUsers;
  }
  return role === 'owner' || role === 'areaManager' || role === 'admin';
}

function normalizeOrigin(raw) {
  const fallback = getAppOrigin();
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
}

function buildInviteUrl(origin, token) {
  return `${origin}/invite?token=${encodeURIComponent(token)}`;
}

function emptyProfileFields(now) {
  return {
    approvedAt: '',
    approvedByEmail: '',
    accessReviewStoreIdsJson: '[]',
    accessReviewNote: '',
    preApprovedByUserId: '',
    preApprovedByEmail: '',
    preApprovedAt: '',
    accessReviewRequestedByEmail: '',
    accessReviewRequestedAt: '',
    invitedStoreIdsJson: '[]',
    cameraOptionsJson: '{"weatherEnabled":true,"logoEnabled":true}',
    createdAt: now,
    updatedAt: now,
  };
}

async function requireManager(req) {
  const { userId, email } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  if (!canManageUsers(ctx.role, ctx.roleDefinition)) {
    const err = new Error('Forbidden: canManageUsers required');
    err.status = 403;
    throw err;
  }
  return { ...ctx, email: email || ctx.email };
}

async function findInviteByToken(adminDb, token) {
  const tokenHash = hashInviteToken(token);
  const result = await adminDb.query({
    invitations: { $: { where: { tokenHash } } },
  });
  return result.invitations?.[0] ?? null;
}

async function resolveStoreNames(adminDb, storeIds) {
  if (!storeIds.length) return [];
  const result = await adminDb.query({ stores: {} });
  const byId = new Map((result.stores ?? []).map((s) => [s.id, s.name || s.code || s.id]));
  return storeIds.map((sid) => byId.get(sid) || sid);
}

function publicPayload(inv, storeNames) {
  return {
    status: inv.status,
    emailMasked: maskEmail(inv.email),
    email: inv.email,
    role: inv.role,
    storeNames,
    invitedByEmail: inv.invitedByEmail || '',
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt || '',
  };
}

async function createInvite(req, res) {
  const ctx = await requireManager(req);
  const body = parseBody(req.body) || {};
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'staff').trim() || 'staff';
  const storeIds = Array.isArray(body.storeIds)
    ? body.storeIds.map(String).filter(Boolean)
    : parseStoreIdsJson(body.storeIdsJson);
  const origin = normalizeOrigin(body.origin);

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (OWNER_ONLY_ROLES.has(role) && ctx.role !== 'owner') {
    return res.status(403).json({
      error: 'Only the owner can invite users as owner or area manager',
    });
  }

  const adminDb = getAdminDb();
  const now = new Date();
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const inviteId = id();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();

  await adminDb.transact([
    adminDb.tx.invitations[inviteId].update({
      tokenHash,
      email,
      role,
      storeIdsJson: JSON.stringify(storeIds),
      invitedByUserId: ctx.userId,
      invitedByEmail: ctx.email || '',
      status: 'pending',
      createdAt,
      expiresAt,
      acceptedAt: '',
      revokedAt: '',
      firstOpenedAt: '',
      lastOpenedAt: '',
      acceptedUserId: '',
      intendedRedirect: '',
    }),
  ]);

  const inviteUrl = buildInviteUrl(origin, token);
  const storeNames = await resolveStoreNames(adminDb, storeIds);

  let emailResult = { sent: false, reason: 'skipped' };
  try {
    emailResult = await sendInviteEmail({
      inviteUrl,
      email,
      role,
      storeNames,
      invitedByEmail: ctx.email,
      expiresAt,
    });
  } catch (e) {
    console.error('[invites/create] email', e);
    emailResult = {
      sent: false,
      reason: e instanceof Error ? e.message : 'email failed',
    };
  }

  return res.status(200).json({
    ok: true,
    invitationId: inviteId,
    email,
    role,
    inviteUrl,
    expiresAt,
    emailSent: !!emailResult.sent,
    emailReason: emailResult.reason || null,
  });
}

async function validateInvite(req, res) {
  const token = String(req.query?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Invalid invitation link' });

  const adminDb = getAdminDb();
  const inv = await findInviteByToken(adminDb, token);
  if (!inv) {
    return res.status(404).json({ error: 'Invalid invitation link', status: 'invalid' });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (inv.status === 'revoked') {
    return res.status(410).json({ error: 'This invitation is no longer active', status: 'revoked' });
  }
  if (inv.status === 'accepted') {
    const storeIds = parseStoreIdsJson(inv.storeIdsJson);
    const storeNames = await resolveStoreNames(adminDb, storeIds);
    return res.status(200).json({
      ok: true,
      ...publicPayload({ ...inv, status: 'accepted' }, storeNames),
    });
  }
  if (inv.status === 'expired' || isExpired(inv.expiresAt, now)) {
    if (inv.status !== 'expired') {
      await adminDb.transact([
        adminDb.tx.invitations[inv.id].update({ status: 'expired' }),
      ]);
    }
    return res.status(410).json({ error: 'This invitation has expired', status: 'expired' });
  }

  const openedPatch = {
    lastOpenedAt: nowIso,
    status: inv.status === 'pending' ? 'opened' : inv.status,
  };
  if (!inv.firstOpenedAt) openedPatch.firstOpenedAt = nowIso;

  await adminDb.transact([adminDb.tx.invitations[inv.id].update(openedPatch)]);

  const storeIds = parseStoreIdsJson(inv.storeIdsJson);
  const storeNames = await resolveStoreNames(adminDb, storeIds);
  return res.status(200).json({
    ok: true,
    ...publicPayload({ ...inv, ...openedPatch }, storeNames),
  });
}

async function acceptInvite(req, res) {
  const body = parseBody(req.body) || {};
  const token = String(body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing invitation token' });

  let authUser;
  try {
    authUser = await verifyRequestUser(req);
  } catch (e) {
    return res.status(e?.status || 401).json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

  const adminDb = getAdminDb();
  const inv = await findInviteByToken(adminDb, token);
  if (!inv) return res.status(404).json({ error: 'Invalid invitation link', status: 'invalid' });

  const authEmail = String(authUser.email || '').trim().toLowerCase();
  const inviteEmail = String(inv.email || '').trim().toLowerCase();
  if (!authEmail || authEmail !== inviteEmail) {
    return res.status(403).json({
      error: 'This invitation was sent to another email address.',
      status: 'email_mismatch',
      invitedEmailMasked: maskEmail(inviteEmail),
    });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (inv.status === 'revoked') {
    return res.status(410).json({ error: 'This invitation is no longer active', status: 'revoked' });
  }
  if (inv.status === 'expired' || isExpired(inv.expiresAt, now)) {
    return res.status(410).json({ error: 'This invitation has expired', status: 'expired' });
  }

  const storeIds = parseStoreIdsJson(inv.storeIdsJson);
  const storeIdsJson = JSON.stringify(storeIds);

  const existing = await adminDb.query({
    profiles: { $: { where: { userId: authUser.userId } } },
  });
  let profile = existing.profiles?.[0];

  if (inv.status === 'accepted') {
    // Idempotent: already accepted for this token
    return res.status(200).json({
      ok: true,
      alreadyAccepted: true,
      role: inv.role,
      storeIds,
      approvalStatus: profile?.approvalStatus || 'pending',
    });
  }

  const txs = [];

  if (!profile) {
    const profileId = id();
    txs.push(
      adminDb.tx.profiles[profileId].update({
        userId: authUser.userId,
        email: inviteEmail,
        displayName: inviteEmail.split('@')[0] || inviteEmail,
        role: inv.role || 'staff',
        approvalStatus: 'pending',
        ...emptyProfileFields(nowIso),
        invitedStoreIdsJson: storeIdsJson,
        accessReviewStoreIdsJson: storeIdsJson,
      }).link({ $user: authUser.userId }),
    );
    profile = { id: profileId, approvalStatus: 'pending' };
  } else if (profile.approvalStatus !== 'approved') {
    txs.push(
      adminDb.tx.profiles[profile.id].update({
        role: inv.role || profile.role || 'staff',
        invitedStoreIdsJson: storeIdsJson,
        accessReviewStoreIdsJson: storeIdsJson,
        updatedAt: nowIso,
      }),
    );
  }

  txs.push(
    adminDb.tx.invitations[inv.id].update({
      status: 'accepted',
      acceptedAt: nowIso,
      acceptedUserId: authUser.userId,
      lastOpenedAt: nowIso,
    }),
  );

  await adminDb.transact(txs);

  const storeNames = await resolveStoreNames(adminDb, storeIds);
  return res.status(200).json({
    ok: true,
    alreadyAccepted: false,
    role: inv.role,
    storeIds,
    storeNames,
    approvalStatus: profile.approvalStatus === 'approved' ? 'approved' : 'pending',
  });
}

async function resendInvite(req, res) {
  const ctx = await requireManager(req);
  const body = parseBody(req.body) || {};
  const invitationId = String(body.invitationId || '').trim();
  const origin = normalizeOrigin(body.origin);
  if (!invitationId) return res.status(400).json({ error: 'invitationId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    invitations: { $: { where: { id: invitationId } } },
  });
  const inv = result.invitations?.[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'accepted') {
    return res.status(400).json({ error: 'Invitation already accepted' });
  }
  if (inv.status === 'revoked') {
    return res.status(400).json({ error: 'Invitation was revoked' });
  }

  const now = new Date();
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();

  await adminDb.transact([
    adminDb.tx.invitations[inv.id].update({
      tokenHash,
      status: 'pending',
      expiresAt,
      revokedAt: '',
      acceptedAt: '',
      acceptedUserId: '',
      firstOpenedAt: '',
      lastOpenedAt: '',
    }),
  ]);

  const inviteUrl = buildInviteUrl(origin, token);
  const storeIds = parseStoreIdsJson(inv.storeIdsJson);
  const storeNames = await resolveStoreNames(adminDb, storeIds);

  let emailResult = { sent: false };
  try {
    emailResult = await sendInviteEmail({
      inviteUrl,
      email: inv.email,
      role: inv.role,
      storeNames,
      invitedByEmail: ctx.email,
      expiresAt,
    });
  } catch (e) {
    emailResult = { sent: false, reason: e instanceof Error ? e.message : 'email failed' };
  }

  return res.status(200).json({
    ok: true,
    inviteUrl,
    expiresAt,
    emailSent: !!emailResult.sent,
    emailReason: emailResult.reason || null,
  });
}

async function revokeInvite(req, res) {
  await requireManager(req);
  const body = parseBody(req.body) || {};
  const invitationId = String(body.invitationId || '').trim();
  if (!invitationId) return res.status(400).json({ error: 'invitationId required' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    invitations: { $: { where: { id: invitationId } } },
  });
  const inv = result.invitations?.[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'accepted') {
    return res.status(400).json({ error: 'Cannot revoke an accepted invitation' });
  }

  const nowIso = new Date().toISOString();
  await adminDb.transact([
    adminDb.tx.invitations[inv.id].update({
      status: 'revoked',
      revokedAt: nowIso,
    }),
  ]);

  return res.status(200).json({ ok: true });
}

async function listInvites(req, res) {
  await requireManager(req);
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    invitations: {},
    stores: {},
  });
  const storesById = new Map((result.stores ?? []).map((s) => [s.id, s.name || s.code || s.id]));
  const now = new Date();

  const rows = (result.invitations ?? [])
    .map((inv) => {
      let status = inv.status;
      if (
        (status === 'pending' || status === 'opened') &&
        isExpired(inv.expiresAt, now)
      ) {
        status = 'expired';
      }
      const storeIds = parseStoreIdsJson(inv.storeIdsJson);
      return {
        id: inv.id,
        email: inv.email,
        role: inv.role,
        storeIds,
        storeNames: storeIds.map((sid) => storesById.get(sid) || sid),
        invitedByEmail: inv.invitedByEmail || '',
        status,
        createdAt: inv.createdAt || '',
        expiresAt: inv.expiresAt || '',
        firstOpenedAt: inv.firstOpenedAt || '',
        lastOpenedAt: inv.lastOpenedAt || '',
        acceptedAt: inv.acceptedAt || '',
        revokedAt: inv.revokedAt || '',
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const counts = {
    sent: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    opened: rows.filter((r) => r.status === 'opened').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    expired: rows.filter((r) => r.status === 'expired').length,
    revoked: rows.filter((r) => r.status === 'revoked').length,
  };

  return res.status(200).json({ ok: true, invitations: rows, counts });
}

export default async function handler(req, res) {
  const action = String(req.query?.action || req.body?.action || '').trim();

  try {
    if (req.method === 'GET' && (action === 'validate' || req.query?.token)) {
      return await validateInvite(req, res);
    }
    if (req.method === 'GET' && action === 'list') {
      return await listInvites(req, res);
    }
    if (req.method === 'POST' && action === 'create') {
      return await createInvite(req, res);
    }
    if (req.method === 'POST' && action === 'accept') {
      return await acceptInvite(req, res);
    }
    if (req.method === 'POST' && action === 'resend') {
      return await resendInvite(req, res);
    }
    if (req.method === 'POST' && action === 'revoke') {
      return await revokeInvite(req, res);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[invites]', action, e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Invite request failed',
    });
  }
}
