/**
 * Vercel Serverless — profile avatar upload (Admin SDK).
 * Path: profile-avatars/{authenticatedUserId}/avatar.{ext}
 * Separate from report-proof media and store logos.
 */

import { init } from '@instantdb/admin';
import { verifyRequestUser } from './_lib/export/auth.js';
import { parseBody } from './_lib/export/instant-admin.js';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

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
    throw new Error(
      'Missing INSTANT_ADMIN_TOKEN. Add it in Vercel → Settings → Environment Variables.',
    );
  }

  return { appId, adminToken };
}

function avatarPath(userId, ext) {
  return `profile-avatars/${userId}/avatar.${ext}`;
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

  const body = parseBody(req.body);
  if (!body?.fileBase64 || !body?.mimeType) {
    return res.status(400).json({ error: 'Missing fileBase64 or mimeType' });
  }

  const mime = String(body.mimeType).split(';')[0].trim().toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) {
    return res.status(400).json({ error: 'Invalid file type. Use PNG, JPEG, or WebP.' });
  }

  let buffer;
  try {
    buffer = Buffer.from(body.fileBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'File too large. Max 5MB.' });
  }

  const path = avatarPath(userId, ext);
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
    const existingFiles = [];
    for (const e of priorExts) {
      const pathTry = `profile-avatars/${userId}/avatar.${e}`;
      const q = await adminDb.query({
        $files: { $: { where: { path: pathTry } } },
      });
      if (q?.$files?.[0]) existingFiles.push(q.$files[0]);
    }

    const { data: fileData } = await adminDb.storage.uploadFile(path, buffer, {
      contentType: mime,
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    });
    const url = filesResult?.$files?.[0]?.url ?? '';
    if (!url) throw new Error('Upload returned no URL');

    await adminDb.transact(
      adminDb.tx.profiles[profile.id].update({
        avatarUrl: url,
        updatedAt: new Date().toISOString(),
      }),
    );

    // Delete older avatar files at different extensions (keep the one we just uploaded)
    const toDelete = existingFiles.filter(
      (f) => f.id !== fileData.id && f.path !== path,
    );
    if (toDelete.length > 0) {
      await adminDb.transact(toDelete.map((f) => adminDb.tx.$files[f.id].delete()));
    }

    return res.status(200).json({ url, path });
  } catch (e) {
    console.error('[upload-avatar]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
}
