/**
 * Vercel Serverless — profile avatar ops (single function for Hobby limit).
 * Actions via ?action= or body.action:
 *   upload | remove | remove-background | resolve
 * Storage path: profile-avatars/{authenticatedUserId}/avatar.{ext}
 */

import { init } from '@instantdb/admin';
import { verifyRequestUser } from './_lib/export/auth.js';
import { parseBody } from './_lib/export/instant-admin.js';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const MAX_BYTES = 5 * 1024 * 1024;
const POOF_URL = 'https://api.poof.bg/v1/remove';
const AVATAR_EXTS = ['png', 'jpg', 'webp'];

const ALLOWED_EXT = {
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

function storageAvatarPath(userId, ext) {
  return `profile-avatars/${userId}/avatar.${ext}`;
}

async function collectAvatarFiles(adminDb, userId) {
  const files = [];
  for (const ext of AVATAR_EXTS) {
    const pathTry = storageAvatarPath(userId, ext);
    const q = await adminDb.query({
      $files: { $: { where: { path: pathTry } } },
    });
    if (q?.$files?.[0]) files.push(q.$files[0]);
  }
  return files;
}

async function loadProfileWithAvatar(adminDb, userId) {
  const profileResult = await adminDb.query({
    profiles: {
      $: { where: { userId } },
      avatarFile: {},
    },
  });
  return profileResult.profiles?.[0] ?? null;
}

async function handleUpload(req, res, userId) {
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
  const ext = ALLOWED_EXT[mime];
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

  const path = storageAvatarPath(userId, ext);
  const adminDb = init({ appId, adminToken });

  try {
    const profile = await loadProfileWithAvatar(adminDb, userId);
    if (!profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }

    const existingFiles = await collectAvatarFiles(adminDb, userId);

    const { data: fileData } = await adminDb.storage.uploadFile(path, buffer, {
      contentType: mime,
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    });
    const url = filesResult?.$files?.[0]?.url ?? '';
    if (!url) throw new Error('Upload returned no URL');

    const priorLinkedId = profile.avatarFile?.id;
    const txs = [];
    if (priorLinkedId && priorLinkedId !== fileData.id) {
      txs.push(adminDb.tx.profiles[profile.id].unlink({ avatarFile: priorLinkedId }));
    }
    txs.push(
      adminDb.tx.profiles[profile.id]
        .update({
          avatarPath: path,
          avatarUrl: '',
          updatedAt: new Date().toISOString(),
        })
        .link({ avatarFile: fileData.id }),
    );
    await adminDb.transact(txs);

    const toDelete = existingFiles.filter(
      (f) => f.id !== fileData.id && f.path !== path,
    );
    if (toDelete.length > 0) {
      await adminDb.transact(toDelete.map((f) => adminDb.tx.$files[f.id].delete()));
    }

    return res.status(200).json({ url, path, fileId: fileData.id });
  } catch (e) {
    console.error('[avatar/upload]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
}

async function handleRemove(req, res, userId) {
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
    const profile = await loadProfileWithAvatar(adminDb, userId);
    if (!profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }

    const files = await collectAvatarFiles(adminDb, userId);
    const linkedId = profile.avatarFile?.id;

    const txs = [
      adminDb.tx.profiles[profile.id].update({
        avatarPath: '',
        avatarUrl: '',
        updatedAt: new Date().toISOString(),
      }),
    ];
    if (linkedId) {
      txs.push(adminDb.tx.profiles[profile.id].unlink({ avatarFile: linkedId }));
    }
    txs.push(...files.map((f) => adminDb.tx.$files[f.id].delete()));
    await adminDb.transact(txs);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[avatar/remove]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Remove failed',
    });
  }
}

/**
 * Return a fresh live URL for a profile avatar; lazy-repair link + avatarPath when
 * the storage file still exists but the profile link / path is missing.
 */
async function handleResolve(req, res, callerUserId) {
  let appId;
  let adminToken;
  try {
    ({ appId, adminToken } = getCredentials());
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Missing config',
    });
  }

  const body = parseBody(req.body) || {};
  const targetUserId = String(
    req.query?.userId || body.userId || callerUserId || '',
  ).trim();
  if (!targetUserId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const adminDb = init({ appId, adminToken });

  try {
    const profile = await loadProfileWithAvatar(adminDb, targetUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const linkedUrl = profile.avatarFile?.url?.trim() || '';
    if (linkedUrl) {
      return res.status(200).json({
        url: linkedUrl,
        path: profile.avatarFile?.path || profile.avatarPath || '',
        fileId: profile.avatarFile.id,
        repaired: false,
      });
    }

    const files = await collectAvatarFiles(adminDb, targetUserId);
    const preferredPath = profile.avatarPath?.trim() || '';
    const file =
      (preferredPath && files.find((f) => f.path === preferredPath)) ||
      files[0] ||
      null;

    if (!file?.url) {
      return res.status(200).json({ url: '', path: '', fileId: null, repaired: false });
    }

    await adminDb.transact(
      adminDb.tx.profiles[profile.id]
        .update({
          avatarPath: file.path || preferredPath || '',
          avatarUrl: '',
          updatedAt: new Date().toISOString(),
        })
        .link({ avatarFile: file.id }),
    );

    return res.status(200).json({
      url: file.url,
      path: file.path || '',
      fileId: file.id,
      repaired: true,
    });
  } catch (e) {
    console.error('[avatar/resolve]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Resolve failed',
    });
  }
}

async function handleRemoveBackground(req, res) {
  const apiKey = process.env.POOF_BG_API_KEY || '';
  if (!apiKey) {
    return res.status(500).json({
      error: 'Background removal is not configured. Missing POOF_BG_API_KEY.',
    });
  }

  const body = parseBody(req.body);
  if (!body?.fileBase64 || !body?.mimeType) {
    return res.status(400).json({ error: 'Missing fileBase64 or mimeType' });
  }

  const mime = String(body.mimeType).split(';')[0].trim().toLowerCase();
  if (!ALLOWED_EXT[mime]) {
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

  try {
    const form = new FormData();
    const fileName = `photo.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    const file = new File([buffer], fileName, { type: mime });
    form.append('image_file', file);

    const upstream = await fetch(POOF_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
    });

    if (!upstream.ok) {
      let detail = '';
      try {
        detail = await upstream.text();
      } catch {
        /* ignore */
      }
      if (upstream.status === 402) {
        return res.status(402).json({
          error: 'Background removal credits exhausted. Try again later or save without AI.',
        });
      }
      if (upstream.status === 429) {
        return res.status(429).json({
          error: 'Background removal rate limited. Please wait and retry.',
        });
      }
      if (upstream.status === 401) {
        return res.status(502).json({ error: 'Background removal service authentication failed.' });
      }
      console.error('[avatar/remove-background] poof', upstream.status, detail.slice(0, 300));
      return res.status(502).json({
        error: 'Background removal failed. Your original image was kept — you can retry.',
      });
    }

    const outBuf = Buffer.from(await upstream.arrayBuffer());
    const outMime = upstream.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';

    return res.status(200).json({
      mimeType: outMime,
      fileBase64: outBuf.toString('base64'),
    });
  } catch (e) {
    console.error('[avatar/remove-background]', e);
    return res.status(502).json({
      error: 'Background removal failed. Your original image was kept — you can retry.',
    });
  }
}

export default async function handler(req, res) {
  let userId;
  try {
    ({ userId } = await verifyRequestUser(req));
  } catch (e) {
    const status = e?.status || 401;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

  const body = parseBody(req.body) || {};
  const action = String(req.query?.action || body.action || '').trim();

  if (action === 'resolve') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return handleResolve(req, res, userId);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (action === 'upload') return handleUpload(req, res, userId);
  if (action === 'remove') return handleRemove(req, res, userId);
  if (action === 'remove-background') return handleRemoveBackground(req, res);

  return res.status(400).json({
    error: 'Invalid action. Use upload, remove, remove-background, or resolve.',
  });
}
