/**
 * Composer attachment staging: one local file XOR selected GIPHY.
 * Upload happens on intentional Send (parent); draft text is never cleared here.
 * Retries reuse stable messageId/clientMutationId and a successful upload cache
 * so Instant failures do not re-upload or mint a new row id.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ChatAttachmentKind,
  validateChatAttachmentPolicy,
  type ChatAttachmentPolicyErrorCode,
} from '../../lib/chatAttachmentPolicy';
import type { UploadChatAttachmentResult } from '../../lib/chatAttachmentUpload';
import type { ChatAttachmentPayloadInput } from '../../lib/storeChatMediaPayload';

export type ChatAttachmentStagePhase =
  | 'idle'
  | 'selected'
  | 'preparing'
  | 'uploading'
  | 'sending'
  | 'failed';

export type StagedChatAttachment = {
  localId: string;
  blob: Blob;
  objectUrl: string;
  mimeType: string;
  fileName: string;
  bytes: number;
  kind: ChatAttachmentKind;
  width: number | null;
  height: number | null;
};

export type ChatAttachmentStagingError = {
  code: ChatAttachmentPolicyErrorCode | 'upload_failed' | 'camera_denied' | 'unknown';
  message: string;
};

export type ChatAttachmentSendIds = {
  messageId: string;
  clientMutationId: string;
};

function revokeUrl(url: string | null | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function readImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      revokeUrl(url);
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    img.onerror = () => {
      revokeUrl(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function useChatAttachmentStaging(options?: {
  /** Called when a new attachment is staged (clear GIPHY). */
  onStageAttachment?: () => void;
}) {
  const [staged, setStaged] = useState<StagedChatAttachment | null>(null);
  const [phase, setPhase] = useState<ChatAttachmentStagePhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<ChatAttachmentStagingError | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const stagedRef = useRef<StagedChatAttachment | null>(null);
  const sendIdsRef = useRef<ChatAttachmentSendIds | null>(null);
  const uploadedRef = useRef<UploadChatAttachmentResult | null>(null);
  const onStageAttachmentRef = useRef(options?.onStageAttachment);
  onStageAttachmentRef.current = options?.onStageAttachment;

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  useEffect(
    () => () => {
      revokeUrl(stagedRef.current?.objectUrl);
    },
    [],
  );

  const resetUploadState = useCallback(() => {
    sendIdsRef.current = null;
    uploadedRef.current = null;
  }, []);

  const clear = useCallback(() => {
    setStaged((prev) => {
      revokeUrl(prev?.objectUrl);
      return null;
    });
    setPhase('idle');
    setUploadProgress(0);
    setError(null);
    resetUploadState();
  }, [resetUploadState]);

  const clearError = useCallback(() => setError(null), []);

  const clearCameraDenied = useCallback(() => setCameraDenied(false), []);

  const stageFile = useCallback(
    async (
      file: File | Blob,
      fileNameHint?: string,
    ): Promise<{ ok: true } | { ok: false; error: ChatAttachmentStagingError }> => {
      const mimeType = String(file.type || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const fileName =
        (file instanceof File && file.name) || fileNameHint || 'attachment';
      const bytes = file.size;
      const policy = validateChatAttachmentPolicy({ mimeType, bytes, fileName });
      if (!policy.ok || !policy.kind) {
        const error: ChatAttachmentStagingError = {
          code: policy.errorCode || 'unknown',
          message: policy.errorMessage || 'Invalid attachment',
        };
        setError(error);
        return { ok: false, error };
      }

      onStageAttachmentRef.current?.();
      setCameraDenied(false);
      setError(null);
      setPhase('preparing');
      resetUploadState();

      let width: number | null = null;
      let height: number | null = null;
      if (policy.kind === 'image') {
        const dims = await readImageDimensions(file);
        width = dims?.width ?? null;
        height = dims?.height ?? null;
      }

      const objectUrl = URL.createObjectURL(file);
      setStaged((prev) => {
        revokeUrl(prev?.objectUrl);
        return {
          localId: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          blob: file,
          objectUrl,
          mimeType: policy.mimeType || mimeType,
          fileName,
          bytes,
          kind: policy.kind!,
          width,
          height,
        };
      });
      setPhase('selected');
      setUploadProgress(0);
      return { ok: true };
    },
    [resetUploadState],
  );

  const markUploading = useCallback((progress = 12) => {
    setPhase('uploading');
    setUploadProgress(Math.max(0, Math.min(95, progress)));
    setError(null);
  }, []);

  const bumpUploadProgress = useCallback((progress: number) => {
    setUploadProgress(Math.max(0, Math.min(95, progress)));
  }, []);

  const markSending = useCallback(() => {
    setPhase('sending');
    setUploadProgress(100);
  }, []);

  const markFailed = useCallback((message: string, code: ChatAttachmentStagingError['code'] = 'upload_failed') => {
    setPhase('failed');
    setError({ code, message });
  }, []);

  const markCameraDenied = useCallback(() => {
    setCameraDenied(true);
  }, []);

  /** Stable ids for upload path + Instant create across Retry. */
  const ensureSendIds = useCallback((createId: () => string): ChatAttachmentSendIds => {
    if (!sendIdsRef.current) {
      sendIdsRef.current = {
        messageId: createId(),
        clientMutationId: createId(),
      };
    }
    return sendIdsRef.current;
  }, []);

  const cacheUpload = useCallback((result: UploadChatAttachmentResult) => {
    uploadedRef.current = result;
  }, []);

  const getCachedUpload = useCallback((): UploadChatAttachmentResult | null => {
    return uploadedRef.current;
  }, []);

  const toPayloadInput = useCallback(
    (uploaded: {
      path: string;
      fileId: string;
      url: string;
      mimeType: string;
      fileName: string;
      bytes: number;
      kind: ChatAttachmentKind;
    }): ChatAttachmentPayloadInput | null => {
      const current = stagedRef.current;
      if (!current) return null;
      return {
        kind: uploaded.kind || current.kind,
        path: uploaded.path,
        fileId: uploaded.fileId,
        url: uploaded.url,
        mimeType: uploaded.mimeType || current.mimeType,
        fileName: uploaded.fileName || current.fileName,
        bytes: uploaded.bytes || current.bytes,
        width: current.width,
        height: current.height,
      };
    },
    [],
  );

  return {
    staged,
    phase,
    uploadProgress,
    error,
    cameraDenied,
    hasStaged: Boolean(staged),
    clear,
    clearError,
    clearCameraDenied,
    stageFile,
    markUploading,
    bumpUploadProgress,
    markSending,
    markFailed,
    markCameraDenied,
    ensureSendIds,
    cacheUpload,
    getCachedUpload,
    toPayloadInput,
  };
}

export type ChatAttachmentStagingApi = ReturnType<typeof useChatAttachmentStaging>;
