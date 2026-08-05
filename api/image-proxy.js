/**
 * Vercel Serverless — media helpers (Hobby function-budget consolidation).
 *
 * Modes:
 * - ?url=...     allowlisted image proxy for canvas watermark burn-in
 * - ?mediaId=... resolve proof photo URL via Admin SDK (formerly /api/media-url)
 */

import { init } from '@instantdb/admin';

const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

const ALLOWED_HOSTS = new Set([
  'www.heypelo.com',
  'heypelo.com',
]);

function isAllowedHost(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.instantdb.io')) return true;
  if (hostname.endsWith('.instantdb.com')) return true;
  return false;
}

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

  if (!adminToken) throw new Error('Missing INSTANT_ADMIN_TOKEN');
  return { appId, adminToken };
}

async function handleMediaUrl(req, res) {
  const mediaId = req.query.mediaId;
  if (!mediaId || typeof mediaId !== 'string') {
    return res.status(400).json({ error: 'Missing mediaId' });
  }

  let appId;
  let adminToken;
  try {
    ({ appId, adminToken } = getCredentials());
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Missing config' });
  }

  const adminDb = init({ appId, adminToken });

  try {
    const result = await adminDb.query({
      mediaRecords: {
        $: { where: { id: mediaId } },
        file: {},
      },
    });

    const media = result.mediaRecords?.[0];
    if (!media) {
      return res.status(404).json({ error: 'Media record not found' });
    }

    if (media.storageDeleted) {
      return res.status(410).json({ error: 'Photo removed from storage' });
    }

    let url = media.fileUrl || media.file?.url || '';

    if (!url && media.storagePath) {
      const filesResult = await adminDb.query({
        $files: { $: { where: { path: media.storagePath } } },
      });
      url = filesResult.$files?.[0]?.url ?? '';
    }

    if (!url) {
      return res.status(404).json({ error: 'Photo URL not found' });
    }

    return res.status(200).json({ url });
  } catch (e) {
    console.error('[image-proxy/media-url]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Lookup failed',
    });
  }
}

async function handleImageProxy(req, res) {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTPS URLs allowed' });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return res.status(400).json({ error: 'Host not allowed' });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream fetch failed' });
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ error: 'Image too large' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('[image-proxy]', e);
    return res.status(502).json({ error: 'Proxy failed' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Formerly /api/media-url — keep query compatibility for ProofPhoto callers.
  if (typeof req.query.mediaId === 'string' && req.query.mediaId) {
    return handleMediaUrl(req, res);
  }

  return handleImageProxy(req, res);
}
