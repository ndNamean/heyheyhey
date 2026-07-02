/**
 * Vercel Serverless Function — Proof-photo upload
 *
 * Uploads watermarked proof photos via the InstantDB Admin SDK so staff are
 * not blocked by client-side $files storage permissions.
 *
 * Required Vercel env vars:
 *   VITE_INSTANT_APP_ID
 *   INSTANT_ADMIN_TOKEN
 */

import { init, id } from '@instantdb/admin';
import { requireInstantCredentials } from './instant-config';

interface UploadBody {
  path: string;
  fileName: string;
  fileBase64: string;
  metadata: {
    reportId: string;
    reportResponseId: string;
    storeId: string;
    lat: number;
    lng: number;
    accuracy: number;
    capturedAt: string;
    photoCode: string;
    captureMode: string;
    uploadedByUserId: string;
  };
}

interface Req {
  method?: string;
  body?: UploadBody;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let appId: string;
  let adminToken: string;
  try {
    ({ appId, adminToken } = requireInstantCredentials());
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Missing config' });
  }

  const body = req.body;
  if (!body?.path || !body.fileBase64 || !body.metadata) {
    return res.status(400).json({ error: 'Missing path, fileBase64, or metadata' });
  }

  if (!body.path.startsWith('stores/')) {
    return res.status(400).json({ error: 'Invalid storage path' });
  }

  const adminDb = init({ appId, adminToken: adminToken });

  try {
    const buffer = Buffer.from(body.fileBase64, 'base64');

    const { data: fileData } = await adminDb.storage.uploadFile(body.path, buffer, {
      contentType: 'image/jpeg',
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    } as Parameters<typeof adminDb.query>[0]);

    const fileUrl: string =
      ((filesResult as { $files?: Array<{ url?: string }> }).$files ?? [])[0]?.url ?? '';

    const mediaId = id();
    const m = body.metadata;

    // @ts-expect-error — admin tx types are not generic over schema
    await adminDb.transact(
      // @ts-expect-error
      adminDb.tx.mediaRecords[mediaId]
        .update({
          reportId:           m.reportId,
          reportResponseId:   m.reportResponseId,
          storeId:            m.storeId,
          fileName:           body.fileName,
          mimeType:           'image/jpeg',
          lat:                m.lat ?? 0,
          lng:                m.lng ?? 0,
          accuracy:           m.accuracy ?? 0,
          capturedAt:         m.capturedAt,
          watermarked:        true,
          photoCode:          m.photoCode,
          verificationHash:   '',
          captureMode:        m.captureMode,
          storeDistanceM:     0,
          noteText:           '',
          address:            '',
          uploadedByUserId:   m.uploadedByUserId,
          createdAt:          m.capturedAt,
          storagePath:        body.path,
          deletedAt:          '',
          storageDeleted:     false,
          storageDeletedReason: '',
        })
        .link({ file: fileData.id, reportResponse: m.reportResponseId }),
    );

    return res.status(200).json({
      mediaRecordId: mediaId,
      fileId:        fileData.id,
      url:           fileUrl,
      fileName:      body.fileName,
      photoCode:     m.photoCode,
      capturedAt:    m.capturedAt,
    });
  } catch (e) {
    console.error('[upload-photo]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
}
