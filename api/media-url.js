/**
 * Vercel Serverless — resolve proof photo URL via Admin SDK.
 * Used when client-side $files link/url is unavailable (e.g. legacy records).
 */

import { init } from '@instantdb/admin';

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

  if (!adminToken) throw new Error('Missing INSTANT_ADMIN_TOKEN');
  return { appId, adminToken };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    console.error('[media-url]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Lookup failed',
    });
  }
}
