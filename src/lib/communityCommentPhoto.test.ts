import { describe, expect, it } from 'vitest';
import {
  buildCommunityCommentPhotoPayload,
  commentHasPhotoContent,
  commentPhotoDisplayUrl,
  emptyCommunityCommentPhotoFields,
  stageCommunityCommentPhoto,
} from './communityCommentPhoto';

describe('communityCommentPhoto', () => {
  it('sends empty attachment keys when no photo is staged', () => {
    expect(emptyCommunityCommentPhotoFields()).toEqual({
      attachmentKind: '',
      attachmentPath: '',
      attachmentFileId: '',
      attachmentUrl: '',
      attachmentMimeType: '',
      attachmentFileName: '',
      attachmentBytes: '',
      attachmentWidth: '',
      attachmentHeight: '',
    });
    expect(buildCommunityCommentPhotoPayload(null)).toEqual(emptyCommunityCommentPhotoFields());
  });

  it('maps an uploaded image onto comment photo fields', () => {
    const payload = buildCommunityCommentPhotoPayload({
      kind: 'image',
      path: 'stores/community/post-a/c.jpg',
      fileId: 'file-1',
      url: 'https://example.com/c.jpg',
      mimeType: 'image/jpeg',
      fileName: 'c.jpg',
      bytes: 12,
      width: 80,
      height: 60,
    });
    expect(payload.attachmentKind).toBe('image');
    expect(payload.attachmentUrl).toBe('https://example.com/c.jpg');
    expect(payload.attachmentWidth).toBe('80');
    expect(commentHasPhotoContent(payload)).toBe(true);
    expect(commentPhotoDisplayUrl(payload)).toBe('https://example.com/c.jpg');
  });

  it('prefers the linked file url and ignores file attachments', () => {
    expect(
      commentPhotoDisplayUrl({
        attachmentUrl: 'https://example.com/denorm.jpg',
        attachmentFile: { url: 'https://example.com/linked.jpg' },
      }),
    ).toBe('https://example.com/linked.jpg');
    expect(
      commentHasPhotoContent({
        attachmentKind: 'file',
        attachmentPath: 'stores/community/post-a/note.pdf',
        attachmentUrl: 'https://example.com/note.pdf',
      }),
    ).toBe(false);
  });

  it('rejects non-image files at stage time', async () => {
    const pdf = new File(['%PDF'], 'note.pdf', { type: 'application/pdf' });
    const result = await stageCommunityCommentPhoto(pdf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });
});
