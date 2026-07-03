/**
 * Vercel Serverless — allowlisted image proxy for canvas watermark burn-in.
 * Avoids CORS blocks on external logo URLs (e.g. heypelo.com).
 */

const MAX_BYTES = 2 * 1024 * 1024;

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
