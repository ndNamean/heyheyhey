/**
 * Invite a user: send Instant magic-code email (with sign-in link in template)
 * and return a direct invite URL that includes email, role, and code.
 */

import { getAdminDb, parseBody } from './_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from './_lib/export/auth.js';
import { getAppOrigin } from './_lib/magic-code-email.js';

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

function buildInviteLink({ origin, email, role, code }) {
  const params = new URLSearchParams();
  params.set('invite', email);
  if (role) params.set('role', role);
  if (code) params.set('code', code);
  return `${origin}/?${params.toString()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let ctx;
  try {
    const { userId } = await verifyRequestUser(req);
    ctx = await loadProfileContext(userId);
  } catch (e) {
    const status = e?.status || 401;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

  if (!canManageUsers(ctx.role, ctx.roleDefinition)) {
    return res.status(403).json({ error: 'Forbidden: canManageUsers required' });
  }

  const body = parseBody(req.body) || {};
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'staff').trim() || 'staff';
  const origin = normalizeOrigin(body.origin);

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (OWNER_ONLY_ROLES.has(role) && ctx.role !== 'owner') {
    return res.status(403).json({
      error: 'Only the owner can invite users as owner or area manager',
    });
  }

  try {
    const adminDb = getAdminDb();
    const result = await adminDb.auth.sendMagicCode(email);
    const code = result?.code ? String(result.code) : '';

    const inviteLink = buildInviteLink({ origin, email, role, code });

    return res.status(200).json({
      ok: true,
      email,
      role,
      inviteLink,
      // Code is included so the admin UI can show / copy a one-click link.
      // The email Instant sends also contains the code + sign-in link via the
      // Instant custom magic-code email template.
      code: code || undefined,
    });
  } catch (e) {
    console.error('[invite-user]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to send invite',
    });
  }
}
