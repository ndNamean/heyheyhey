/**
 * Vercel Serverless — video proxy with Range request support for HTML5 playback.
 * Resolves media by ID or allowlisted URL; forwards byte-range requests to storage.
 */

import { init } from '@instantdb/admin';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const MAX_BYTES = 50 * 1024 * 1024;

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

function normalizeVideoContentType(contentType, fileName) {
  const ct = (contentType ?? '').split(';')[0]?.trim().toLowerCase() || '';
  if (ct.startsWith('video/')) return ct;
  const name = (fileName ?? '').toLowerCase();
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.webm')) return 'video/webm';
  return 'video/webm';
}

async function resolveMediaUrl(adminDb, mediaId) {
  const result = await adminDb.query({
    mediaRecords: {
      $: { where: { id: mediaId } },
      file: {},
    },
  });

  const media = result.mediaRecords?.[0];
  if (!media) return null;
  if (media.storageDeleted) return { error: 'removed', status: 410 };

  let url = media.fileUrl || media.file?.url || '';
  if (!url && media.storagePath) {
    const filesResult = await adminDb.query({
      $files: { $: { where: { path: media.storagePath } } },
    });
    url = filesResult.$files?.[0]?.url ?? '';
  }

  if (!url) return { error: 'not_found', status: 404 };

  return {
    url,
    fileName: media.fileName ?? '',
    mimeType: media.mimeType ?? '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const mediaId = typeof req.query.mediaId === 'string' ? req.query.mediaId : '';
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';

  let upstreamUrl = '';
  let fileName = '';
  let storedMime = '';

  if (mediaId) {
    let appId;
    let adminToken;
    try {
      ({ appId, adminToken } = getCredentials());
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Missing config' });
    }

    const adminDb = init({ appId, adminToken });
    try {
      const resolved = await resolveMediaUrl(adminDb, mediaId);
      if (!resolved) {
        return res.status(404).json({ error: 'Media record not found' });
      }
      if (resolved.error === 'removed') {
        return res.status(410).json({ error: 'Video removed from storage' });
      }
      if (resolved.error === 'not_found') {
        return res.status(404).json({ error: 'Video URL not found' });
      }
      upstreamUrl = resolved.url;
      fileName = resolved.fileName;
      storedMime = resolved.mimeType;
    } catch (e) {
      console.error('[video-proxy] lookup', e);
      return res.status(500).json({ error: 'Lookup failed' });
    }
  } else if (rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid url' });
    }
    if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
      return res.status(400).json({ error: 'Host not allowed' });
    }
    upstreamUrl = parsed.toString();
  } else {
    return res.status(400).json({ error: 'Missing mediaId or url' });
  }

  try {
    const upstreamHeaders = {};
    const range = req.headers.range;
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: 'Upstream fetch failed' });
    }

    const upstreamType = upstream.headers.get('content-type') ?? storedMime;
    const contentType = normalizeVideoContentType(upstreamType, fileName);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (req.method === 'HEAD') {
      return res.status(upstream.status).end();
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Video too large' });
    }

    return res.status(upstream.status).send(buffer);
  } catch (e) {
    console.error('[video-proxy]', e);
    return res.status(502).json({ error: 'Proxy failed' });
  }
}
