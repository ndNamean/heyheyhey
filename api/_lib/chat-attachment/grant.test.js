import { describe, expect, it } from 'vitest';
import {
  assertCanUploadChatAttachment,
  buildChatAttachmentGrant,
} from './grant.js';
import {
  ATTACHMENT_TOO_LARGE_COPY,
  JSON_REQUEST_BYTE_BUDGET,
  assertJsonFitsFunctionBody,
  grantPayloadHasFileBytes,
  jsonPayloadByteLength,
} from './json-budget.js';

function jpegPrefixBase64() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString(
    'base64',
  );
}

function pngPrefixBase64() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
    'base64',
  );
}

const communityTarget = {
  scope: 'community',
  storeId: '',
  roomId: '',
  postId: 'post-1',
};

describe('assertCanUploadChatAttachment', () => {
  const approved = {
    userId: 'u1',
    role: 'staff',
    storeIds: ['store-1'],
    roleDefinition: null,
    roleDefinitions: [],
  };

  it('rejects invalid scope', async () => {
    await expect(
      assertCanUploadChatAttachment(approved, { scope: 'other' }, { query: async () => ({}) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects community without postId', async () => {
    await expect(
      assertCanUploadChatAttachment(approved, { scope: 'community' }, { query: async () => ({}) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('allows community for viewers', async () => {
    const target = await assertCanUploadChatAttachment(
      { ...approved, role: 'viewer' },
      { scope: 'community', postId: 'post-1' },
      { query: async () => ({}) },
    );
    expect(target).toEqual({
      scope: 'community',
      storeId: '',
      roomId: '',
      postId: 'post-1',
    });
  });

  it('rejects viewers for store chat', async () => {
    await expect(
      assertCanUploadChatAttachment(
        { ...approved, role: 'viewer' },
        { scope: 'store', storeId: 'store-1' },
        { query: async () => ({}) },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects store uploads without access', async () => {
    await expect(
      assertCanUploadChatAttachment(
        approved,
        { scope: 'store', storeId: 'store-other' },
        { query: async () => ({}) },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows store uploads with access', async () => {
    const target = await assertCanUploadChatAttachment(
      approved,
      { scope: 'store', storeId: 'store-1' },
      { query: async () => ({}) },
    );
    expect(target.storeId).toBe('store-1');
  });

  it('rejects group uploads without membership', async () => {
    await expect(
      assertCanUploadChatAttachment(
        approved,
        { scope: 'group', roomId: 'room-1' },
        { query: async () => ({ groupChatMembers: [] }) },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('buildChatAttachmentGrant', () => {
  it('returns a stores/ path from tiny JSON without fileBase64', () => {
    const body = {
      scope: 'community',
      postId: 'post-1',
      messageId: 'c1',
      mimeType: 'image/jpeg',
      bytes: 3800 * 1024,
      fileName: 'photo.jpg',
      magicPrefix: jpegPrefixBase64(),
    };
    expect(grantPayloadHasFileBytes(body)).toBe(false);
    expect(jsonPayloadByteLength(body)).toBeLessThan(2048);
    const grant = buildChatAttachmentGrant(body, communityTarget, {
      fallbackMessageKey: 'fallback',
    });
    expect(grant.path).toBe('stores/community/post-1/photo.jpg');
    expect(grant.kind).toBe('image');
    expect(grant.bytes).toBe(3800 * 1024);
    expect(grant.mimeType).toBe('image/jpeg');
    expect(body.fileBase64).toBeUndefined();
  });

  it('rejects oversize declared bytes', () => {
    expect(() =>
      buildChatAttachmentGrant(
        {
          mimeType: 'image/jpeg',
          bytes: 5 * 1024 * 1024 + 1,
          fileName: 'big.jpg',
          magicPrefix: jpegPrefixBase64(),
        },
        communityTarget,
        { fallbackMessageKey: 'x' },
      ),
    ).toThrow(/too large/i);
  });

  it('rejects magic bytes that do not match the declared type', () => {
    try {
      buildChatAttachmentGrant(
        {
          mimeType: 'image/jpeg',
          bytes: 1200,
          fileName: 'fake.jpg',
          magicPrefix: pngPrefixBase64(),
        },
        communityTarget,
        { fallbackMessageKey: 'x' },
      );
      throw new Error('expected grant to fail');
    } catch (err) {
      expect(err).toMatchObject({ code: 'mime_mismatch', status: 400 });
    }
  });

  it('rejects missing magic prefix', () => {
    expect(() =>
      buildChatAttachmentGrant(
        {
          mimeType: 'image/jpeg',
          bytes: 1200,
          fileName: 'photo.jpg',
        },
        communityTarget,
        { fallbackMessageKey: 'x' },
      ),
    ).toThrow(/magicPrefix/i);
  });
});

describe('json request byte budget', () => {
  it('allows a typical grant payload', () => {
    const body = {
      action: 'chat_attachment',
      scope: 'store',
      storeId: 's1',
      mimeType: 'image/jpeg',
      bytes: 5 * 1024 * 1024,
      fileName: 'photo.jpg',
      magicPrefix: jpegPrefixBase64(),
    };
    expect(assertJsonFitsFunctionBody(body)).toBeLessThan(4096);
    expect(JSON_REQUEST_BYTE_BUDGET).toBeGreaterThan(4 * 1024 * 1024);
  });

  it('refuses leftover fileBase64 so function JSON never carries file bytes', () => {
    expect(() =>
      assertJsonFitsFunctionBody({
        mimeType: 'image/jpeg',
        fileBase64: 'a'.repeat(100),
      }),
    ).toThrow(ATTACHMENT_TOO_LARGE_COPY);
  });
});
