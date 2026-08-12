import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  db: {
    getAuth: vi.fn(async () => ({ refresh_token: 'tok' })),
  },
}));

vi.mock('./avatarClient', () => ({
  blobToBase64: vi.fn(async () => 'YmFzZTY0'),
}));

import { uploadChatAttachment } from './chatAttachmentUpload';

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

  it('allows group upload without storeId and posts room-scoped body', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          fileId: 'f1',
          url: 'https://example.com/f1',
          path: 'stores/group-chat/room-1/m1/note.txt',
          mimeType: 'text/plain',
          bytes: 1,
          fileName: 'note.txt',
          kind: 'file',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await uploadChatAttachment({
      blob: new Blob(['x'], { type: 'text/plain' }),
      mimeType: 'text/plain',
      fileName: 'note.txt',
      scope: 'group',
      roomId: 'room-1',
      messageId: 'm1',
      clientMutationId: 'cm1',
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.path).toContain('group-chat/room-1');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}'));
    expect(body.scope).toBe('group');
    expect(body.roomId).toBe('room-1');
    expect(body.storeId).toBeUndefined();
    expect(body.clientMutationId).toBe('cm1');
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
});
