/**
 * Client wrapper for /api/upload-chat-attachment.
 * Encodes Blob via blobToBase64 (avatarClient) without coupling to avatar validation.
 */

import { db } from '../db';
import { blobToBase64 } from './avatarClient';
import {
  type ChatAttachmentKind,
  validateChatAttachmentPolicy,
} from './chatAttachmentPolicy';
import { isChatAttachmentsEnabled } from './chatAttachmentsFlag';

export interface UploadChatAttachmentParams {
  blob: Blob;
  mimeType: string;
  fileName?: string;
  scope: 'store' | 'group';
  /** Required when scope === 'store'. Ignored for group (rooms are not store-scoped). */
  storeId?: string;
  /** Required when scope === 'group'. */
  roomId?: string;
  /** Optional pre-generated message id for storage path + later Instant link. */
  messageId?: string;
  clientMutationId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Override feature flag (tests). */
  enabled?: boolean;
}

export interface UploadChatAttachmentResult {
  fileId: string;
  url: string;
  path: string;
  mimeType: string;
  bytes: number;
  fileName: string;
  kind: ChatAttachmentKind;
}

async function authHeaders() {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJson(resp: Response) {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`,
      );
    }
  }
  if (!resp.ok) {
    throw Object.assign(
      new Error(String(data.error || `Request failed (${resp.status})`)),
      { status: resp.status, data },
    );
  }
  return data;
}

export async function uploadChatAttachment(
  params: UploadChatAttachmentParams,
): Promise<UploadChatAttachmentResult> {
  const enabled =
    params.enabled ?? isChatAttachmentsEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Chat attachments are disabled'), {
      status: 403,
      code: 'feature_disabled',
    });
  }

  const mimeType = String(params.mimeType || params.blob.type || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const bytes = params.blob.size;
  const policy = validateChatAttachmentPolicy({
    mimeType,
    bytes,
    fileName: params.fileName,
  });
  if (!policy.ok) {
    throw Object.assign(new Error(policy.errorMessage || 'Invalid attachment'), {
      status: 400,
      code: policy.errorCode,
    });
  }

  if (params.scope === 'store') {
    const storeId = String(params.storeId || '').trim();
    if (!storeId) throw new Error('Missing storeId');
  } else if (params.scope === 'group') {
    if (!String(params.roomId || '').trim()) {
      throw new Error('Missing roomId');
    }
  } else {
    throw new Error('Invalid scope');
  }

  const storeId =
    params.scope === 'store' ? String(params.storeId || '').trim() : undefined;
  const roomId =
    params.scope === 'group' ? String(params.roomId || '').trim() : undefined;

  const headers = await authHeaders();
  const fileBase64 = await blobToBase64(params.blob);
  const fetchImpl = params.fetchImpl ?? fetch;
  const resp = await fetchImpl('/api/upload-chat-attachment', {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      scope: params.scope,
      storeId,
      roomId,
      messageId: params.messageId ? String(params.messageId).trim() : undefined,
      clientMutationId: params.clientMutationId
        ? String(params.clientMutationId).trim()
        : undefined,
      fileName: params.fileName || undefined,
      mimeType,
      fileBase64,
    }),
  });
  const data = await parseJson(resp);
  return {
    fileId: String(data.fileId ?? ''),
    url: String(data.url ?? ''),
    path: String(data.path ?? ''),
    mimeType: String(data.mimeType ?? mimeType),
    bytes: Number(data.bytes ?? bytes) || bytes,
    fileName: String(data.fileName ?? params.fileName ?? 'attachment'),
    kind: (data.kind as ChatAttachmentKind) || policy.kind!,
  };
}
