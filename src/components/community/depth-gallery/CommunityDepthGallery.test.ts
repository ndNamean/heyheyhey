import { describe, expect, it } from 'vitest';
import type { CommunityPost } from '../../../types';
import {
  COMMUNITY_GALLERY_MAX_PLANES,
  buildCommunityGalleryPosts,
  isCommunityImagePost,
} from './gallerySet';

function imagePost(id: string, extra: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id,
    authorUserId: 'u',
    authorProfileId: 'p',
    authorNameSnapshot: 'A',
    authorRoleSnapshot: '',
    body: '',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    attachmentKind: 'image',
    attachmentPath: `stores/community/${id}/a.jpg`,
    attachmentFileId: 'f',
    attachmentUrl: `https://example.com/${id}.jpg`,
    attachmentMimeType: 'image/jpeg',
    attachmentFileName: 'a.jpg',
    attachmentBytes: '1',
    attachmentWidth: '10',
    attachmentHeight: '10',
    famousVoteCount: 0,
    uniqueReactorCount: 0,
    uniqueCommenterCount: 0,
    commentCount: 0,
    lastActivityAt: '2026-09-07T00:00:00.000Z',
    moodBackgroundColor: '#fffaf0',
    moodBlob1Color: '#ffdf94',
    moodBlob2Color: '#fce7c4',
    ...extra,
  };
}

describe('community gallery set', () => {
  it('caps at 24 image posts and starts at the tapped index', () => {
    expect(COMMUNITY_GALLERY_MAX_PLANES).toBe(24);
    const posts = Array.from({ length: 30 }, (_, i) => imagePost(`p${i}`));
    const { posts: slice, startIndex } = buildCommunityGalleryPosts(posts, 'p20');
    expect(slice).toHaveLength(24);
    expect(slice[startIndex]?.id).toBe('p20');
    expect(isCommunityImagePost(imagePost('x'))).toBe(true);
    expect(
      isCommunityImagePost(
        imagePost('text', {
          attachmentKind: '',
          attachmentPath: '',
          attachmentUrl: '',
          attachmentFileId: '',
        }),
      ),
    ).toBe(false);
  });

  it('dedupes Famous + feed and ignores text posts', () => {
    const famous = imagePost('pin');
    const text = imagePost('txt', {
      attachmentKind: '',
      attachmentPath: '',
      attachmentUrl: '',
      attachmentFileId: '',
    });
    const { posts, startIndex } = buildCommunityGalleryPosts(
      [famous, famous, text, imagePost('a')],
      'a',
    );
    expect(posts.map((p) => p.id)).toEqual(['pin', 'a']);
    expect(startIndex).toBe(1);
  });
});
