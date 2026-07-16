/**
 * Vercel Serverless — AI background removal via Poof.bg (free tier).
 * API key stays server-side (POOF_BG_API_KEY). Requires authenticated user.
 */

import { verifyRequestUser } from './_lib/export/auth.js';
import { parseBody } from './_lib/export/instant-admin.js';

const MAX_BYTES = 5 * 1024 * 1024;
const POOF_URL = 'https://api.poof.bg/v1/remove';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await verifyRequestUser(req);
  } catch (e) {
    const status = e?.status || 401;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

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
  if (!ALLOWED.has(mime)) {
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
      console.error('[remove-background] poof', upstream.status, detail.slice(0, 300));
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
    console.error('[remove-background]', e);
    return res.status(502).json({
      error: 'Background removal failed. Your original image was kept — you can retry.',
    });
  }
}
