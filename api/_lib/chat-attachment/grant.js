/**
 * Chat-attachment grant: authorize a storage path without sending file bytes
 * through the Vercel function.
 */

import { userHasStoreAccess } from '../wifi-notify/access.js';
import {
  MAGIC_PREFIX_MAX_BYTES,
  assertJsonFitsFunctionBody,
} from './json-budget.js';
import {
  bufferMatchesDeclaredMime,
  buildChatAttachmentStoragePath,
  sanitizeChatAttachmentFileName,
  sanitizePathSegment,
  validateChatAttachmentPolicy,
} from './policy.js';

export async function assertCanUploadChatAttachment(ctx, body, adminDb) {
  const scope = String(body.scope || '')
    .trim()
    .toLowerCase();
  if (scope !== 'store' && scope !== 'group' && scope !== 'community') {
    const err = new Error('Invalid scope. Use store, group, or community.');
    err.status = 400;
    throw err;
  }

  if (scope === 'community') {
    const postId = sanitizePathSegment(body.postId || body.messageId, '');
    if (!postId) {
      const err = new Error('Missing or invalid postId');
      err.status = 400;
      throw err;
    }
    // Any approved profile may upload Community media (including viewer).
    return { scope, storeId: '', roomId: '', postId };
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

function decodeMagicPrefix(raw) {
  const encoded = String(raw || '');
  if (!encoded) {
    const err = new Error('Missing magicPrefix');
    err.status = 400;
    throw err;
  }
  if (encoded.length > 128) {
    const err = new Error('Invalid magic prefix');
    err.status = 400;
    throw err;
  }
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    const err = new Error('Invalid magic prefix');
    err.status = 400;
    throw err;
  }
  if (!buffer.length) {
    const err = new Error('Invalid magic prefix');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAGIC_PREFIX_MAX_BYTES) {
    buffer = buffer.subarray(0, MAGIC_PREFIX_MAX_BYTES);
  }
  return buffer;
}

/**
 * Build an authorized Instant storage path from declared metadata + magic bytes.
 * Does not accept or decode fileBase64.
 */
export function buildChatAttachmentGrant(body, target, opts) {
  assertJsonFitsFunctionBody(body);

  const mimeType = body?.mimeType;
  if (!mimeType) {
    const err = new Error('Missing mimeType');
    err.status = 400;
    throw err;
  }

  const bytes = Number(body?.bytes);
  const policy = validateChatAttachmentPolicy({
    mimeType,
    bytes,
    fileName: body?.fileName,
  });
  if (!policy.ok) {
    const err = new Error(policy.errorMessage || 'Invalid attachment');
    err.status = 400;
    err.code = policy.errorCode;
    throw err;
  }

  const prefix = decodeMagicPrefix(body?.magicPrefix);
  if (!bufferMatchesDeclaredMime(prefix, policy.mimeType)) {
    const err = new Error('File contents do not match the declared type.');
    err.status = 400;
    err.code = 'mime_mismatch';
    throw err;
  }

  const fileName = sanitizeChatAttachmentFileName(
    body?.fileName || '',
    policy.mimeType,
  );
  const fallback = String(opts?.fallbackMessageKey || 'msg');
  const messageKey = sanitizePathSegment(
    body?.messageId || body?.clientMutationId || fallback,
    fallback,
  );
  const path = buildChatAttachmentStoragePath({
    scope: target.scope,
    storeId: target.storeId,
    roomId: target.roomId,
    postId: target.postId,
    messageKey: target.scope === 'community' ? target.postId : messageKey,
    fileName,
  });

  return {
    path,
    mimeType: policy.mimeType,
    bytes,
    fileName,
    kind: policy.kind,
  };
}
