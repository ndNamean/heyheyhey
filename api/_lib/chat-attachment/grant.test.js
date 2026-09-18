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
import { CHAT_VIDEO_MAX_BYTES } from './policy.js';

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

function ftypPrefixBase64() {
  return Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).toString(
    'base64',
  );
}

function webmPrefixBase64() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]).toString(
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

  it('grants community video with ftyp or webm prefix', () => {
    const mp4 = buildChatAttachmentGrant(
      {
        mimeType: 'video/mp4',
        bytes: 2 * 1024 * 1024,
        fileName: 'clip.mp4',
        magicPrefix: ftypPrefixBase64(),
      },
      communityTarget,
      { fallbackMessageKey: 'x' },
    );
    expect(mp4.kind).toBe('video');
    expect(mp4.path).toBe('stores/community/post-1/clip.mp4');

    const webm = buildChatAttachmentGrant(
      {
        mimeType: 'video/webm',
        bytes: 1024,
        fileName: 'clip.webm',
        magicPrefix: webmPrefixBase64(),
      },
      communityTarget,
      { fallbackMessageKey: 'x' },
    );
    expect(webm.kind).toBe('video');
  });

  it('rejects store or group video grants even with matching magic', () => {
    expect(() =>
      buildChatAttachmentGrant(
        {
          mimeType: 'video/mp4',
          bytes: 1024,
          fileName: 'clip.mp4',
          magicPrefix: ftypPrefixBase64(),
        },
        { scope: 'store', storeId: 's1', roomId: '' },
        { fallbackMessageKey: 'x' },
      ),
    ).toThrow(/unsupported file type/i);

    try {
      buildChatAttachmentGrant(
        {
          mimeType: 'video/mp4',
          bytes: 1024,
          fileName: 'clip.mp4',
          magicPrefix: ftypPrefixBase64(),
        },
        { scope: 'group', storeId: '', roomId: 'room-1' },
        { fallbackMessageKey: 'x' },
      );
      throw new Error('expected grant to fail');
    } catch (err) {
      expect(err).toMatchObject({ code: 'invalid_type', status: 400 });
    }
  });

  it('rejects community video over 25 MiB', () => {
    expect(() =>
      buildChatAttachmentGrant(
        {
          mimeType: 'video/mp4',
          bytes: CHAT_VIDEO_MAX_BYTES + 1,
          fileName: 'clip.mp4',
          magicPrefix: ftypPrefixBase64(),
        },
        communityTarget,
        { fallbackMessageKey: 'x' },
      ),
    ).toThrow(/too large/i);
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
