import { describe, expect, it, vi } from 'vitest';
import { CHAT_IMAGE_MAX_BYTES } from './chatAttachmentPolicy';
import { ATTACHMENT_TOO_LARGE_COPY } from './vercelFunctionJsonBudget';

vi.mock('../db', () => ({
  db: {
    getAuth: vi.fn(async () => ({ refresh_token: 'tok' })),
  },
}));

vi.mock('./avatarClient', () => ({
  blobToBase64: vi.fn(async (blob: Blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    return `prefix-${buf.length}`;
  }),
}));

import { uploadChatAttachment } from './chatAttachmentUpload';

function jpegBlob(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return new Blob([bytes], { type: 'image/jpeg' });
}

function grantResponse(extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      path: 'stores/community/post-1/note.txt',
      mimeType: 'text/plain',
      bytes: 1,
      fileName: 'note.txt',
      kind: 'file',
      ...extra,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('uploadChatAttachment', () => {
  it('refuses when feature flag is off', async () => {
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        scope: 'store',
        storeId: 's1',
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('requires storeId for store scope and roomId for group scope', async () => {
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        scope: 'store',
        enabled: true,
      }),
    ).rejects.toThrow(/storeId/i);

    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        scope: 'group',
        enabled: true,
      }),
    ).rejects.toThrow(/roomId/i);
  });

  it('requires postId or messageId for community scope', async () => {
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        scope: 'community',
        enabled: true,
      }),
    ).rejects.toThrow(/postId/i);
  });

  it('grants then uploads via Instant storage without sending file bytes', async () => {
    const fetchImpl = vi.fn(async () =>
      grantResponse({
        path: 'stores/group-chat/room-1/m1/note.txt',
        mimeType: 'text/plain',
        bytes: 1,
        fileName: 'note.txt',
        kind: 'file',
      }),
    );
    const storageUploadFile = vi.fn(async () => ({ data: { id: 'f1' } }));
    const queryOnceImpl = vi.fn(async () => ({
      data: { $files: [{ url: 'https://example.com/f1' }] },
    }));

    const blob = new Blob(['x'], { type: 'text/plain' });
    const result = await uploadChatAttachment({
      blob,
      mimeType: 'text/plain',
      fileName: 'note.txt',
      scope: 'group',
      roomId: 'room-1',
      messageId: 'm1',
      clientMutationId: 'cm1',
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storageUploadFile,
      queryOnceImpl,
    });

    expect(result.path).toContain('group-chat/room-1');
    expect(result.fileId).toBe('f1');
    expect(result.url).toBe('https://example.com/f1');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}'));
    expect(body.scope).toBe('group');
    expect(body.roomId).toBe('room-1');
    expect(body.storeId).toBeUndefined();
    expect(body.clientMutationId).toBe('cm1');
    expect(body.fileBase64).toBeUndefined();
    expect(body.magicPrefix).toBeTruthy();
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body ?? '')).not.toContain('xxxx');
    expect(JSON.stringify(body).length).toBeLessThan(2048);
    expect(storageUploadFile).toHaveBeenCalledWith(
      'stores/group-chat/room-1/m1/note.txt',
      expect.anything(),
      { contentType: 'text/plain' },
    );
  });

  it('allows community upload without storeId and posts community-scoped grant body', async () => {
    const fetchImpl = vi.fn(async () =>
      grantResponse({
        path: 'stores/community/post-1/note.txt',
      }),
    );
    const storageUploadFile = vi.fn(async () => ({ data: { id: 'f2' } }));
    const queryOnceImpl = vi.fn(async () => ({
      data: { $files: [{ url: 'https://example.com/f2' }] },
    }));

    const result = await uploadChatAttachment({
      blob: new Blob(['x'], { type: 'text/plain' }),
      mimeType: 'text/plain',
      fileName: 'note.txt',
      scope: 'community',
      postId: 'post-1',
      messageId: 'post-1',
      clientMutationId: 'cm2',
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storageUploadFile,
      queryOnceImpl,
    });

    expect(result.path).toBe('stores/community/post-1/note.txt');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}'));
    expect(body.scope).toBe('community');
    expect(body.postId).toBe('post-1');
    expect(body.storeId).toBeUndefined();
    expect(body.roomId).toBeUndefined();
    expect(body.fileBase64).toBeUndefined();
    expect(storageUploadFile).toHaveBeenCalledTimes(1);
  });

  it('accepts a 5 MiB jpeg at policy then grants without file bytes', async () => {
    const fetchImpl = vi.fn(async () =>
      grantResponse({
        path: 'stores/s1/chat/m1/photo.jpg',
        mimeType: 'image/jpeg',
        bytes: CHAT_IMAGE_MAX_BYTES,
        fileName: 'photo.jpg',
        kind: 'image',
      }),
    );
    const storageUploadFile = vi.fn(async (path: string, file: Blob) => {
      expect(file.size).toBe(CHAT_IMAGE_MAX_BYTES);
      expect(path).toBe('stores/s1/chat/m1/photo.jpg');
      return { data: { id: 'img-5' } };
    });
    const queryOnceImpl = vi.fn(async () => ({
      data: { $files: [{ url: 'https://example.com/img-5' }] },
    }));

    const result = await uploadChatAttachment({
      blob: jpegBlob(CHAT_IMAGE_MAX_BYTES),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      scope: 'store',
      storeId: 's1',
      messageId: 'm1',
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storageUploadFile,
      queryOnceImpl,
    });
    expect(result.bytes).toBe(CHAT_IMAGE_MAX_BYTES);
    const rawBody = String(fetchImpl.mock.calls[0]?.[1]?.body ?? '');
    expect(rawBody.length).toBeLessThan(4096);
    expect(JSON.parse(rawBody).fileBase64).toBeUndefined();
  });

  it('rejects oversized images before network', async () => {
    const fetchImpl = vi.fn();
    const storageUploadFile = vi.fn();
    await expect(
      uploadChatAttachment({
        blob: jpegBlob(CHAT_IMAGE_MAX_BYTES + 1),
        mimeType: 'image/jpeg',
        fileName: 'huge.jpg',
        scope: 'store',
        storeId: 's1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        storageUploadFile,
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storageUploadFile).not.toHaveBeenCalled();
  });

  it('rejects policy violations before fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'application/zip' }),
        mimeType: 'application/zip',
        fileName: 'x.zip',
        scope: 'store',
        storeId: 's1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_type' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects store/group video before fetch and allows community video policy', async () => {
    const fetchImpl = vi.fn();
    const clip = new Blob([new Uint8Array(32)], { type: 'video/mp4' });
    await expect(
      uploadChatAttachment({
        blob: clip,
        mimeType: 'video/mp4',
        fileName: 'clip.mp4',
        scope: 'store',
        storeId: 's1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_type' });
    await expect(
      uploadChatAttachment({
        blob: clip,
        mimeType: 'video/mp4',
        fileName: 'clip.mp4',
        scope: 'group',
        roomId: 'r1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_type' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP 413 to size copy instead of Request failed (413)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('payload too large', {
          status: 413,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        fileName: 'note.txt',
        scope: 'store',
        storeId: 's1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        storageUploadFile: vi.fn(),
      }),
    ).rejects.toMatchObject({
      status: 413,
      code: 'too_large',
      message: ATTACHMENT_TOO_LARGE_COPY,
    });
  });

  it('keeps 400 JSON error messages', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Missing or invalid postId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(
      uploadChatAttachment({
        blob: new Blob(['x'], { type: 'text/plain' }),
        mimeType: 'text/plain',
        fileName: 'note.txt',
        scope: 'community',
        postId: 'post-1',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        storageUploadFile: vi.fn(),
      }),
    ).rejects.toThrow('Missing or invalid postId');
  });
});
