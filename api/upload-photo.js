/**
 * Vercel Serverless — proof photo upload (Admin SDK).
 * Plain JS so Vercel can run it without TS compile issues.
 */

import { init, id } from '@instantdb/admin';
import { verifyRequestUser, loadProfileContext } from './_lib/export/auth.js';
import { userHasStoreAccess } from './_lib/wifi-notify/access.js';
import {
  bufferMatchesDeclaredMime,
  buildChatAttachmentStoragePath,
  sanitizeChatAttachmentFileName,
  sanitizePathSegment,
  validateChatAttachmentPolicy,
} from './_lib/chat-attachment/policy.js';

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

function normalizeContentType(mime) {
  const base = String(mime ?? '').split(';')[0]?.trim().toLowerCase() || '';
  if (base.startsWith('video/')) {
    if (base.includes('mp4')) return 'video/mp4';
    return 'video/webm';
  }
  if (base === 'image/png') return 'image/png';
  if (base.startsWith('image/')) return 'image/jpeg';
  return base || 'image/jpeg';
}

function isChatAttachmentRequest(req, body) {
  const action = String(req?.query?.action || body?.action || '')
    .trim()
    .toLowerCase();
  const scope = String(body?.scope || '')
    .trim()
    .toLowerCase();
  return action === 'chat_attachment' || scope === 'store' || scope === 'group';
}

async function assertCanUploadChatAttachment(ctx, body, adminDb) {
  const scope = String(body.scope || '').trim().toLowerCase();
  if (scope !== 'store' && scope !== 'group') {
    const err = new Error('Invalid scope. Use store or group.');
    err.status = 400;
    throw err;
  }

  if (ctx.role === 'viewer') {
    const err = new Error('Viewers cannot upload chat attachments');
    err.status = 403;
    throw err;
  }

  if (scope === 'store') {
    const storeId = sanitizePathSegment(body.storeId, '');
    if (!storeId) {
      const err = new Error('Missing or invalid storeId');
      err.status = 400;
      throw err;
    }
    if (!userHasStoreAccess(ctx, storeId)) {
      const err = new Error('Forbidden: no Store Chat access for this store');
      err.status = 403;
      throw err;
    }
    return { scope, storeId, roomId: '' };
  }

  const roomId = sanitizePathSegment(body.roomId, '');
  if (!roomId) {
    const err = new Error('Missing or invalid roomId');
    err.status = 400;
    throw err;
  }

  const membership = await adminDb.query({
    groupChatMembers: {
      $: { where: { roomId, userId: ctx.userId } },
    },
  });
  if (!membership.groupChatMembers?.[0]) {
    const err = new Error('Forbidden: not a member of this group chat');
    err.status = 403;
    throw err;
  }

  return { scope, storeId: '', roomId };
}

async function handleChatAttachmentUpload(req, res, body, adminDb) {
  let userId;
  try {
    ({ userId } = await verifyRequestUser(req));
  } catch (e) {
    const status = e?.status || 401;
    return res
      .status(status)
      .json({ error: e instanceof Error ? e.message : 'Unauthorized' });
  }

  let ctx;
  try {
    ctx = await loadProfileContext(userId);
  } catch (e) {
    const status = e?.status || 403;
    return res
      .status(status)
      .json({ error: e instanceof Error ? e.message : 'Forbidden' });
  }

  if (!body?.fileBase64 || !body?.mimeType) {
    return res.status(400).json({ error: 'Missing fileBase64 or mimeType' });
  }

  let target;
  try {
    target = await assertCanUploadChatAttachment(ctx, body, adminDb);
  } catch (e) {
    const status = e?.status || 403;
    return res
      .status(status)
      .json({ error: e instanceof Error ? e.message : 'Forbidden' });
  }

  let buffer;
  try {
    buffer = Buffer.from(String(body.fileBase64), 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  const policy = validateChatAttachmentPolicy({
    mimeType: body.mimeType,
    bytes: buffer.length,
    fileName: body.fileName,
  });
  if (!policy.ok) {
    return res.status(400).json({
      error: policy.errorMessage || 'Invalid attachment',
      code: policy.errorCode,
    });
  }

  if (!bufferMatchesDeclaredMime(buffer, policy.mimeType)) {
    return res.status(400).json({
      error: 'File contents do not match the declared type.',
      code: 'mime_mismatch',
    });
  }

  const fileName = sanitizeChatAttachmentFileName(
    body.fileName || '',
    policy.mimeType,
  );
  const messageKey = sanitizePathSegment(
    body.messageId || body.clientMutationId || id(),
    id(),
  );
  const path = buildChatAttachmentStoragePath({
    scope: target.scope,
    storeId: target.storeId,
    roomId: target.roomId,
    messageKey,
    fileName,
  });

  try {
    const { data: fileData } = await adminDb.storage.uploadFile(path, buffer, {
      contentType: policy.mimeType,
    });
    if (!fileData?.id) throw new Error('Upload returned no file ID');

    const filesResult = await adminDb.query({
      $files: { $: { where: { id: fileData.id } } },
    });
    const url = filesResult?.$files?.[0]?.url ?? '';
    if (!url) throw new Error('Upload returned no URL');

    return res.status(200).json({
      fileId: fileData.id,
      url,
      path,
      mimeType: policy.mimeType,
      bytes: buffer.length,
      fileName,
      kind: policy.kind,
    });
  } catch (e) {
    console.error('[upload-chat-attachment]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Upload failed',
    });
  }
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

  const adminDb = init({ appId, adminToken });
  if (isChatAttachmentRequest(req, body)) {
    return handleChatAttachmentUpload(req, res, body || {}, adminDb);
  }

  if (!body?.path || !body.fileBase64 || !body.metadata) {
    return res.status(400).json({ error: 'Missing path, fileBase64, or metadata' });
  }

  if (!body.path.startsWith('stores/')) {
    return res.status(400).json({ error: 'Invalid storage path' });
  }

  try {
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const m = body.metadata;
    const contentType = normalizeContentType(body.contentType || body.mimeType || 'image/jpeg');
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
