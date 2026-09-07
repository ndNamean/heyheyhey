import {
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from '../../../lib/chatAttachmentDisplay';
import type { CommunityPost } from '../../../types';

export const COMMUNITY_GALLERY_MAX_PLANES = 24;

export function isCommunityImagePost(post: CommunityPost): boolean {
  return (
    messageHasChatAttachment(post) &&
    String(post.attachmentKind || '').trim() === 'image' &&
    Boolean(resolveChatAttachmentUrl(post))
  );
}

export function buildCommunityGalleryPosts(
  source: CommunityPost[],
  startPostId: string,
  max = COMMUNITY_GALLERY_MAX_PLANES,
): { posts: CommunityPost[]; startIndex: number } {
  const seen = new Set<string>();
  const images: CommunityPost[] = [];
  for (const post of source) {
    if (!post?.id || seen.has(post.id) || !isCommunityImagePost(post)) continue;
    seen.add(post.id);
    images.push(post);
  }
  if (!images.length) return { posts: [], startIndex: 0 };

  let tapped = images.findIndex((post) => post.id === startPostId);
  if (tapped < 0) return { posts: images.slice(0, max), startIndex: 0 };
  if (images.length <= max) return { posts: images, startIndex: tapped };

  const half = Math.floor(max / 2);
  let from = Math.max(0, tapped - half);
  from = Math.min(from, images.length - max);
  const slice = images.slice(from, from + max);
  return { posts: slice, startIndex: tapped - from };
}
