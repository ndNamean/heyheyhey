/**
 * Client wrapper for chat attachments.
 * Tiny grant JSON goes through /api/upload-chat-attachment; file bytes go to
 * Instant `db.storage.uploadFile` so Vercel never sees a 5 MiB JSON body.
 */

import { db } from '../db';
import { blobToBase64 } from './avatarClient';
import {
  type ChatAttachmentKind,
  validateChatAttachmentPolicy,
} from './chatAttachmentPolicy';
import { isChatAttachmentsEnabled } from './chatAttachmentsFlag';
import {
  ATTACHMENT_TOO_LARGE_COPY,
  MAGIC_PREFIX_MAX_BYTES,
  assertJsonFitsFunctionBody,
} from './vercelFunctionJsonBudget';

export interface UploadChatAttachmentParams {
  blob: Blob;
  mimeType: string;
  fileName?: string;
  scope: 'store' | 'group' | 'community';
  /** Required when scope === 'store'. Ignored for group (rooms are not store-scoped). */
  storeId?: string;
  /** Required when scope === 'group'. */
  roomId?: string;
  /**
   * Required when scope === 'community' (or reuse messageId as the object key).
   * Storage path: stores/community/{postId}/{fileName}.
   */
  postId?: string;
  /** Optional pre-generated message id for storage path + later Instant link. */
  messageId?: string;
  clientMutationId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Override feature flag (tests). */
  enabled?: boolean;
  storageUploadFile?: (
    path: string,
    file: Blob | File,
    opts?: { contentType?: string },
  ) => Promise<{ data?: { id?: string } | null }>;
  queryOnceImpl?: (query: {
    $files: { $: { where: { id: string } } };
  }) => Promise<{ data?: { $files?: Array<{ url?: string }> } }>;
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

type InstantStorageClient = {
  storage?: {
    uploadFile?: UploadChatAttachmentParams['storageUploadFile'];
  };
  queryOnce?: UploadChatAttachmentParams['queryOnceImpl'];
};

async function authHeaders() {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function throwTooLarge(): never {
  throw Object.assign(new Error(ATTACHMENT_TOO_LARGE_COPY), {
    status: 413,
    code: 'too_large',
  });
}

async function parseJson(resp: Response) {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (resp.status === 413) throwTooLarge();
      throw new Error(
        resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`,
      );
    }
  }
  if (!resp.ok) {
    if (resp.status === 413) throwTooLarge();
    throw Object.assign(
      new Error(String(data.error || `Request failed (${resp.status})`)),
      { status: resp.status, data },
    );
  }
  return data;
}

async function blobMagicPrefixBase64(blob: Blob): Promise<string> {
  const prefix = blob.slice(0, MAGIC_PREFIX_MAX_BYTES);
  return blobToBase64(prefix);
}

function resolveStorageUpload(
  override?: UploadChatAttachmentParams['storageUploadFile'],
) {
  if (override) return override;
  const uploadFile = (db as InstantStorageClient).storage?.uploadFile;
  return typeof uploadFile === 'function' ? uploadFile : null;
}

function resolveQueryOnce(
  override?: UploadChatAttachmentParams['queryOnceImpl'],
) {
  if (override) return override;
  const queryOnce = (db as InstantStorageClient).queryOnce;
  return typeof queryOnce === 'function' ? queryOnce.bind(db) : null;
}

export async function uploadChatAttachment(
  params: UploadChatAttachmentParams,
): Promise<UploadChatAttachmentResult> {
  const enabled = params.enabled ?? isChatAttachmentsEnabled();
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
    scope: params.scope,
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
  } else if (params.scope === 'community') {
    if (!String(params.postId || params.messageId || '').trim()) {
      throw new Error('Missing postId');
    }
  } else {
    throw new Error('Invalid scope');
  }

  const storeId =
    params.scope === 'store' ? String(params.storeId || '').trim() : undefined;
  const roomId =
    params.scope === 'group' ? String(params.roomId || '').trim() : undefined;
  const postId =
    params.scope === 'community'
      ? String(params.postId || params.messageId || '').trim()
      : undefined;

  const magicPrefix = await blobMagicPrefixBase64(params.blob);
  const grantBody: Record<string, unknown> = {
    action: 'chat_attachment',
    scope: params.scope,
    storeId,
    roomId,
    postId,
    messageId: params.messageId ? String(params.messageId).trim() : undefined,
    clientMutationId: params.clientMutationId
      ? String(params.clientMutationId).trim()
      : undefined,
    fileName: params.fileName || undefined,
    mimeType,
    bytes,
    magicPrefix,
  };
  assertJsonFitsFunctionBody(grantBody);

  const headers = await authHeaders();
  const fetchImpl = params.fetchImpl ?? fetch;
  const resp = await fetchImpl('/api/upload-chat-attachment', {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify(grantBody),
  });
  const grant = await parseJson(resp);
  const path = String(grant.path ?? '');
  if (!path.startsWith('stores/')) {
    throw new Error('Invalid storage path');
  }

  const uploadFile = resolveStorageUpload(params.storageUploadFile);
  if (!uploadFile) {
    throw Object.assign(
      new Error(
        'Original files cannot be uploaded in this client. Images max 5MB, files max 10MB.',
      ),
      { code: 'upload_unavailable' },
    );
  }

  const fileName = String(grant.fileName ?? params.fileName ?? 'attachment');
  const contentType = String(grant.mimeType ?? mimeType);
  const file =
    params.blob instanceof File
      ? params.blob
      : typeof File === 'function'
        ? new File([params.blob], fileName, { type: contentType })
        : params.blob;

  const uploaded = await uploadFile(path, file, { contentType });
  const fileId = String(uploaded?.data?.id ?? '');
  if (!fileId) throw new Error('Upload returned no file ID');

  const queryOnce = resolveQueryOnce(params.queryOnceImpl);
  if (!queryOnce) {
    throw new Error('Upload returned no URL');
  }
  const filesResult = await queryOnce({
    $files: { $: { where: { id: fileId } } },
  });
  const url = String(filesResult?.data?.$files?.[0]?.url ?? '');
  if (!url) throw new Error('Upload returned no URL');

  return {
    fileId,
    url,
    path,
    mimeType: contentType,
    bytes: Number(grant.bytes ?? bytes) || bytes,
    fileName,
    kind: (grant.kind as ChatAttachmentKind) || policy.kind!,
  };
}
