import {
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from '../../../lib/chatAttachmentDisplay';
import type { CommunityPost } from '../../../types';

/** Mounted DOM planes around the live pair. Navigation is uncapped. */
export const COMMUNITY_GALLERY_RENDER_RADIUS = 2;
export const COMMUNITY_GALLERY_PREFETCH_DISTANCE = 3;

export function isCommunityImagePost(post: CommunityPost): boolean {
  return (
    messageHasChatAttachment(post) &&
    String(post.attachmentKind || '').trim() === 'image' &&
    Boolean(resolveChatAttachmentUrl(post))
  );
}

function dedupeCommunityPosts(source: CommunityPost[]): CommunityPost[] {
  const seen = new Set<string>();
  const posts: CommunityPost[] = [];
  for (const post of source) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }
  return posts;
}

/** Full feed order (image, text, file). Famous prepend happens in the page source. */
export function buildCommunityGalleryPosts(
  source: CommunityPost[],
  startPostId: string,
): { posts: CommunityPost[]; startIndex: number } {
  const posts = dedupeCommunityPosts(source);
  if (!posts.length) return { posts: [], startIndex: 0 };
  const tapped = posts.findIndex((post) => post.id === startPostId);
  if (tapped < 0) return { posts, startIndex: 0 };
  return { posts, startIndex: tapped };
}

/**
 * Keep the open-session id prefix. Append only ids that appear after the current
 * last id in `nextSource` (older pages). Ignore prepends and Famous swaps.
 */
export function appendGallerySession(
  sessionPosts: CommunityPost[],
  nextSource: CommunityPost[],
): CommunityPost[] {
  if (!sessionPosts.length) return dedupeCommunityPosts(nextSource);

  const nextList = dedupeCommunityPosts(nextSource);
  const byId = new Map<string, CommunityPost>();
  for (const post of nextList) byId.set(post.id, post);

  const sessionIds = new Set(sessionPosts.map((post) => post.id));
  const kept = sessionPosts.map((post) => byId.get(post.id) ?? post);

  const lastId = sessionPosts[sessionPosts.length - 1]?.id;
  const lastIndex = lastId ? nextList.findIndex((post) => post.id === lastId) : -1;
  const appended: CommunityPost[] = [];
  if (lastIndex >= 0) {
    for (let i = lastIndex + 1; i < nextList.length; i++) {
      const post = nextList[i];
      if (!post?.id || sessionIds.has(post.id)) continue;
      sessionIds.add(post.id);
      appended.push(post);
    }
  }

  if (!appended.length) {
    let changed = false;
    for (let i = 0; i < kept.length; i++) {
      if (kept[i] !== sessionPosts[i]) {
        changed = true;
        break;
      }
    }
    return changed ? kept : sessionPosts;
  }
  return kept.concat(appended);
}

export function shouldPrefetchGallery(
  index: number,
  length: number,
  prefetchDistance = COMMUNITY_GALLERY_PREFETCH_DISTANCE,
): boolean {
  if (!(length > 0) || !Number.isFinite(index) || !Number.isFinite(prefetchDistance)) return false;
  return index >= length - prefetchDistance;
}

/** End copy only on the last plane after Instant has no further pages. */
export function shouldShowGalleryEnd(input: {
  canLoadNextPage: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  currentIndex: number;
  length: number;
}): boolean {
  if (input.canLoadNextPage || input.isLoadingMore || input.loadMoreError) return false;
  if (!(input.length > 0) || !Number.isFinite(input.currentIndex)) return false;
  return input.currentIndex >= input.length - 1;
}

export function galleryRenderWindow(
  currentIndex: number,
  nextIndex: number,
  length: number,
  radius = COMMUNITY_GALLERY_RENDER_RADIUS,
): { from: number; to: number } {
  if (!(length > 0)) return { from: 0, to: -1 };
  const from = Math.max(0, Math.min(currentIndex, nextIndex) - radius);
  const to = Math.min(length - 1, Math.max(currentIndex, nextIndex) + radius);
  return { from, to };
}

export function galleryWindowPostIds(
  posts: Array<{ id: string }>,
  currentIndex: number,
  nextIndex: number,
  radius = COMMUNITY_GALLERY_RENDER_RADIUS,
): string[] {
  const { from, to } = galleryRenderWindow(currentIndex, nextIndex, posts.length, radius);
  const ids: string[] = [];
  for (let i = from; i <= to; i++) {
    const id = posts[i]?.id;
    if (id) ids.push(id);
  }
  return ids;
}
