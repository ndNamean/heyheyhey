/**
 * Vercel Serverless — proof logo upload (Admin SDK).
 * Separate from proof photos: settings/logos/{storeId}/proof-logo.{ext}
 */

import { init } from '@instantdb/admin';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '3mb',
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

function parseBody(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
  if (!body?.storeId || !body?.fileBase64 || !body?.mimeType) {
    return res.status(400).json({ error: 'Missing storeId, fileBase64, or mimeType' });
  }

  const ext = ALLOWED[body.mimeType];
  if (!ext) {
    return res.status(400).json({ error: 'Invalid file type. Use PNG, JPEG, or WebP.' });
  }

  const storeId = String(body.storeId).trim();
  if (!storeId) {
    return res.status(400).json({ error: 'Invalid storeId' });
  }

  let buffer;
  try {
    buffer = Buffer.from(body.fileBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'File too large. Max 2MB.' });
  }

  const path = `settings/logos/${storeId}/proof-logo.${ext}`;
  const adminDb = init({ appId, adminToken });

  try {
    const { data: fileData } = await adminDb.storage.uploadFile(path, buffer, {
      contentType: body.mimeType,
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    });

    const url = filesResult?.$files?.[0]?.url ?? '';
    return res.status(200).json({ url, path });
  } catch (e) {
    console.error('[upload-logo]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
}
