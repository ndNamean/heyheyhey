/**
 * Vercel Serverless — chat attachment upload (Admin SDK).
 * Paths: stores/{storeId}/chat/{messageId}/... or stores/group-chat/{roomId}/...
 * Does NOT create mediaRecords. Authz: Store Chat access or Group membership.
 */

import { init, id } from '@instantdb/admin';
import { verifyRequestUser, loadProfileContext } from './_lib/export/auth.js';
import { parseBody } from './_lib/export/instant-admin.js';
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
      // Base64 overhead for up to 10MB files (+ JSON wrapper).
      sizeLimit: '14mb',
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

async function assertCanUpload(ctx, body) {
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

  // Group chat: membership-only authz. Rooms are not store-scoped; do not
  // require client storeId / authorizedStores (can be empty for invitees).
  const roomId = sanitizePathSegment(body.roomId, '');
  if (!roomId) {
    const err = new Error('Missing or invalid roomId');
    err.status = 400;
    throw err;
  }

  const adminDb = init(getCredentials());
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const body = parseBody(req.body) || {};
  if (!body?.fileBase64 || !body?.mimeType) {
    return res.status(400).json({ error: 'Missing fileBase64 or mimeType' });
  }

  let target;
  try {
    target = await assertCanUpload(ctx, body);
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
