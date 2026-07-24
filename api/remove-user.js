import { getAdminDb, parseBody } from './_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from './_lib/export/auth.js';
import { validateRemoveUserTarget } from './_lib/remove-user-guards.js';

async function collectAvatarFiles(adminDb, userId) {
  const priorExts = ['png', 'jpg', 'webp'];
  const files = [];
  for (const ext of priorExts) {
    const pathTry = `profile-avatars/${userId}/avatar.${ext}`;
    const filesResult = await adminDb.query({
      $files: { $: { where: { path: pathTry } } },
    });
    if (filesResult?.$files?.[0]) files.push(filesResult.$files[0]);
  }
  return files;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    const actor = await loadProfileContext(userId);

    const body = parseBody(req.body) || {};
    const profileId = String(body.profileId || '').trim();
    if (!profileId) {
      return res.status(400).json({ error: 'Missing profileId' });
    }

    const adminDb = getAdminDb();
    const result = await adminDb.query({
      profiles: { $: { where: { id: profileId } } },
    });
    const target = result.profiles?.[0] ?? null;

    const guard = validateRemoveUserTarget({
      actorRole: actor.role,
      actorUserId: actor.userId,
      target,
    });
    if (!guard.ok) {
      return res.status(guard.status).json({ error: guard.error });
    }

    const avatarFiles = await collectAvatarFiles(adminDb, target.userId);
    await adminDb.transact([
      adminDb.tx.profiles[target.id].delete(),
      ...avatarFiles.map((f) => adminDb.tx.$files[f.id].delete()),
    ]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[remove-user]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Remove failed',
    });
  }
}
