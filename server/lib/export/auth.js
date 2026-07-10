/**
 * Server-side auth: verify refresh token and load profile context.
 */

import { getAdminDb, extractBearerToken } from './instant-admin.js';

export async function verifyRequestUser(req) {
  const token = extractBearerToken(req);
  if (!token) {
    const err = new Error('Missing authorization token');
    err.status = 401;
    throw err;
  }

  const adminDb = getAdminDb();
  const user = await adminDb.auth.verifyToken(token);
  if (!user?.id) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }

  return { userId: user.id, email: user.email ?? '' };
}

export async function loadProfileContext(userId) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    profiles: {
      $: { where: { userId } },
      stores: {},
    },
  });

  const profile = result.profiles?.[0];
  if (!profile) {
    const err = new Error('Profile not found');
    err.status = 403;
    throw err;
  }

  if (profile.approvalStatus !== 'approved') {
    const err = new Error('Account not approved');
    err.status = 403;
    throw err;
  }

  const storeIds = (profile.stores ?? []).map((s) => s.id);

  return {
    profileId: profile.id,
    userId: profile.userId,
    role: profile.role,
    approvalStatus: profile.approvalStatus,
    displayName: profile.displayName ?? '',
    email: profile.email ?? '',
    storeIds,
    stores: profile.stores ?? [],
  };
}

export async function authenticateExportRequest(req) {
  const { userId, email } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  return { ...ctx, email };
}
