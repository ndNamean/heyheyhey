/**
 * Vercel Serverless — remove profile avatar (Admin SDK).
 * Clears profiles.avatarUrl and deletes profile-avatars/{userId}/ files.
 */

import { init } from '@instantdb/admin';
import { verifyRequestUser } from './_lib/export/auth.js';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

function getCredentials() {
  const appId =
    process.env.VITE_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID ||
    DEFAULT_APP_ID;

  const adminToken =
    process.env.INSTANT_ADMIN_TOKEN ||
    process.env.INSTANT_APP_ADMIN_TOKEN ||
    process.env.INSTANT_CLI_AUTH_TOKEN ||
    '';

  if (!adminToken) {
    throw new Error('Missing INSTANT_ADMIN_TOKEN');
  }

  return { appId, adminToken };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let userId;
  try {
    ({ userId } = await verifyRequestUser(req));
  } catch (e) {
    const status = e?.status || 401;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

  let appId;
  let adminToken;
  try {
    ({ appId, adminToken } = getCredentials());
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Missing config',
    });
  }

  const adminDb = init({ appId, adminToken });

  try {
    const profileResult = await adminDb.query({
      profiles: { $: { where: { userId } } },
    });
    const profile = profileResult.profiles?.[0];
    if (!profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }

    const priorExts = ['png', 'jpg', 'webp'];
    const files = [];
    for (const e of priorExts) {
      const pathTry = `profile-avatars/${userId}/avatar.${e}`;
      const filesResult = await adminDb.query({
        $files: { $: { where: { path: pathTry } } },
      });
      if (filesResult?.$files?.[0]) files.push(filesResult.$files[0]);
    }

    const txs = [
      adminDb.tx.profiles[profile.id].update({
        avatarUrl: '',
        updatedAt: new Date().toISOString(),
      }),
      ...files.map((f) => adminDb.tx.$files[f.id].delete()),
    ];
    await adminDb.transact(txs);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[remove-avatar]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Remove failed',
    });
  }
}
