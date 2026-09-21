import { describe, expect, it } from 'vitest';
import type { CommunityPost } from '../../../types';
import { dominantGalleryPostId } from './CommunityDepthGallery';
import {
  COMMUNITY_GALLERY_RENDER_RADIUS,
  appendGallerySession,
  buildCommunityGalleryPosts,
  canOpenCommunityGallery,
  galleryRenderWindow,
  galleryWindowPostIds,
  isCommunityImagePost,
  shouldPrefetchGallery,
  shouldShowGalleryEnd,
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

function textPost(id: string, body = 'hello'): CommunityPost {
  return imagePost(id, {
    body,
    attachmentKind: '',
    attachmentPath: '',
    attachmentUrl: '',
    attachmentFileId: '',
    attachmentFileName: '',
    attachmentMimeType: '',
  });
}

describe('community gallery set', () => {
  it('keeps the full sequence including text and does not cap at 24', () => {
    expect(COMMUNITY_GALLERY_RENDER_RADIUS).toBe(2);
    const posts = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? imagePost(`p${i}`) : textPost(`p${i}`, `text ${i}`),
    );
    const { posts: sequence, startIndex } = buildCommunityGalleryPosts(posts, 'p20');
    expect(sequence).toHaveLength(30);
    expect(sequence[startIndex]?.id).toBe('p20');
    expect(sequence.some((post) => post.id === 'p21' && !isCommunityImagePost(post))).toBe(true);
    expect(isCommunityImagePost(imagePost('x'))).toBe(true);
    expect(isCommunityImagePost(textPost('text'))).toBe(false);
    expect(canOpenCommunityGallery(imagePost('x'))).toBe(true);
    expect(
      canOpenCommunityGallery(
        imagePost('vid', {
          attachmentKind: 'video',
          attachmentMimeType: 'video/mp4',
          attachmentFileName: 'clip.mp4',
          attachmentUrl: 'https://example.com/clip.mp4',
        }),
      ),
    ).toBe(true);
    expect(canOpenCommunityGallery(textPost('text'))).toBe(false);
    expect(
      canOpenCommunityGallery(
        imagePost('file', {
          attachmentKind: 'file',
          attachmentMimeType: 'application/pdf',
          attachmentFileName: 'a.pdf',
          attachmentUrl: 'https://example.com/a.pdf',
        }),
      ),
    ).toBe(false);
    expect(
      isCommunityImagePost(
        imagePost('vid', {
          attachmentKind: 'video',
          attachmentMimeType: 'video/mp4',
          attachmentFileName: 'clip.mp4',
          attachmentUrl: 'https://example.com/clip.mp4',
        }),
      ),
    ).toBe(false);
  });

  it('dedupes Famous + feed, keeps text posts, and starts at the tapped image', () => {
    const famous = imagePost('pin');
    const text = textPost('txt', 'later text');
    const { posts, startIndex } = buildCommunityGalleryPosts(
      [famous, famous, text, imagePost('a')],
      'a',
    );
    expect(posts.map((p) => p.id)).toEqual(['pin', 'txt', 'a']);
    expect(startIndex).toBe(2);
  });

  it('appendGallerySession ignores prepends and only appends trailing ids', () => {
    const session = [imagePost('a'), textPost('b')];
    const next = [imagePost('new'), imagePost('a'), textPost('b'), imagePost('c'), textPost('d')];
    expect(appendGallerySession(session, next).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(appendGallerySession(session, [imagePost('new'), imagePost('a'), textPost('b')]).map((p) => p.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('shouldPrefetchGallery is true within 3 of the last loaded plane', () => {
    expect(shouldPrefetchGallery(11, 15)).toBe(false);
    expect(shouldPrefetchGallery(12, 15)).toBe(true);
    expect(shouldPrefetchGallery(14, 15)).toBe(true);
    expect(shouldPrefetchGallery(0, 3)).toBe(true);
    expect(shouldPrefetchGallery(0, 0)).toBe(false);
  });

  it('shouldShowGalleryEnd only on the last plane after Instant has no next page', () => {
    const base = {
      canLoadNextPage: false,
      isLoadingMore: false,
      loadMoreError: false,
      length: 20,
    };
    expect(shouldShowGalleryEnd({ ...base, currentIndex: 0 })).toBe(false);
    expect(shouldShowGalleryEnd({ ...base, currentIndex: 18 })).toBe(false);
    expect(shouldShowGalleryEnd({ ...base, currentIndex: 19 })).toBe(true);
    expect(shouldShowGalleryEnd({ ...base, canLoadNextPage: true, currentIndex: 19 })).toBe(false);
    expect(shouldShowGalleryEnd({ ...base, isLoadingMore: true, currentIndex: 19 })).toBe(false);
    expect(shouldShowGalleryEnd({ ...base, loadMoreError: true, currentIndex: 19 })).toBe(false);
  });

  it('galleryRenderWindow stays within radius 2 of the live pair', () => {
    expect(galleryRenderWindow(0, 1, 30)).toEqual({ from: 0, to: 3 });
    expect(galleryRenderWindow(10, 11, 30)).toEqual({ from: 8, to: 13 });
    expect(galleryRenderWindow(29, 29, 30)).toEqual({ from: 27, to: 29 });
    const ids = galleryWindowPostIds(
      Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` })),
      0,
      1,
    );
    expect(ids).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('dominantGalleryPostId', () => {
  const posts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('uses the current plane when blend is below halfway', () => {
    expect(
      dominantGalleryPostId(
        posts,
        { currentPlaneIndex: 1, nextPlaneIndex: 2, depthBlend: 0.49 },
        'fallback',
      ),
    ).toBe('b');
  });

  it('uses the next plane at halfway and beyond', () => {
    expect(
      dominantGalleryPostId(
        posts,
        { currentPlaneIndex: 1, nextPlaneIndex: 2, depthBlend: 0.5 },
        'fallback',
      ),
    ).toBe('c');
  });

  it('falls back when the index is missing', () => {
    expect(
      dominantGalleryPostId(
        posts,
        { currentPlaneIndex: 9, nextPlaneIndex: 9, depthBlend: 0 },
        'fallback',
      ),
    ).toBe('fallback');
  });
});
