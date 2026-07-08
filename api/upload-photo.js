/**
 * Vercel Serverless — proof photo upload (Admin SDK).
 * Plain JS so Vercel can run it without TS compile issues.
 */

import { init, id } from '@instantdb/admin';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
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
  if (!body?.path || !body.fileBase64 || !body.metadata) {
    return res.status(400).json({ error: 'Missing path, fileBase64, or metadata' });
  }

  if (!body.path.startsWith('stores/')) {
    return res.status(400).json({ error: 'Invalid storage path' });
  }

  const adminDb = init({ appId, adminToken });

  try {
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const m = body.metadata;
    const contentType = body.contentType || body.mimeType || 'image/jpeg';
    const watermarked = m.watermarked ?? contentType.startsWith('image/');

    const { data: fileData } = await adminDb.storage.uploadFile(body.path, buffer, {
      contentType,
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    });

    const fileUrl = filesResult?.$files?.[0]?.url ?? '';

    const mediaId = id();

    await adminDb.transact(
      adminDb.tx.mediaRecords[mediaId]
        .update({
          reportId: m.reportId,
          reportResponseId: m.reportResponseId,
          storeId: m.storeId,
          fileName: body.fileName,
          mimeType: contentType,
          lat: m.lat ?? 0,
          lng: m.lng ?? 0,
          accuracy: m.accuracy ?? 0,
          capturedAt: m.capturedAt,
          watermarked,
          photoCode: m.photoCode,
          verificationHash: '',
          captureMode: m.captureMode,
          storeDistanceM: 0,
          noteText: '',
          address: m.address ?? '',
          proofMetadataJson: m.proofMetadataJson ?? '',
          uploadedByUserId: m.uploadedByUserId,
          createdAt: m.capturedAt,
          storagePath: body.path,
          fileUrl,
          deletedAt: '',
          storageDeleted: false,
          storageDeletedReason: '',
        })
        .link({ file: fileData.id }),
    );

    return res.status(200).json({
      mediaRecordId: mediaId,
      fileId: fileData.id,
      url: fileUrl,
      fileName: body.fileName,
      photoCode: m.photoCode,
      capturedAt: m.capturedAt,
    });
  } catch (e) {
    console.error('[upload-photo]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
}
