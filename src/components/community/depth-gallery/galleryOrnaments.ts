/**
 * Hashed gallery overlay slots and settle-to-center opacity.
 * Positions depend only on post/entity ids — not depthBlend or scroll direction.
 */

import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import { giphyReactionDisplayUrl } from '../../../lib/storeChatReactions';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import { clamp } from './galleryLayers';
import { hashPostId } from './communityGalleryMoods';

export const GALLERY_ORNAMENT_REACTION_CAP = 8;
export const GALLERY_ORNAMENT_COMMENT_CAP = 6;
export const GALLERY_ORNAMENT_TEXT_CHARS = 48;

/** Top hemisphere, clockwise from east (CSS y-down). */
export const REACTION_ANGLE_MIN = 200;
export const REACTION_ANGLE_MAX = 340;
export const REACTION_RADIUS_MIN = 42;
export const REACTION_RADIUS_MAX = 58;

/** Lower hemisphere, clockwise from east. */
export const COMMENT_ANGLE_MIN = 20;
export const COMMENT_ANGLE_MAX = 160;
export const COMMENT_RADIUS_MIN = 58;
export const COMMENT_RADIUS_MAX = 78;

/** Current-plane reveal: mostly on at blend 0, gone by ~0.5. */
export const SETTLE_CURRENT_START = 0.15;
export const SETTLE_CURRENT_SPAN = 0.35;
/** Next-plane reveal: off until ~0.5, on as next owns center. */
export const SETTLE_NEXT_START = 0.5;
export const SETTLE_NEXT_SPAN = 0.35;

export type OrnamentRole = 'current' | 'next' | 'other';

/** Inner polar band so idle can walk chips onto the photo (12–28% of stack). */
export const INNER_RADIUS_MIN = 12;
export const INNER_RADIUS_MAX = 28;
/** Author rest is center-bottom; idle eases this far up onto the image. */
export const AUTHOR_IDLE_TOP_PCT = 82;

export type PolarSlot = {
  leftPct: number;
  topPct: number;
  angleDeg: number;
  radiusPct: number;
  innerLeftPct: number;
  innerTopPct: number;
  innerRadiusPct: number;
};

export type GalleryReactionOrnament = PolarSlot & {
  id: string;
  unicode: string;
  giphyUrl: string;
  profile: AvatarProfileFields;
};

export type GalleryCommentOrnament = PolarSlot & {
  id: string;
  name: string;
  body: string;
  profile: AvatarProfileFields;
};

export type GalleryAuthorOrnament = {
  name: string;
  body: string;
  profile: AvatarProfileFields;
};

export type GalleryOrnamentLayout = {
  reactions: GalleryReactionOrnament[];
  author: GalleryAuthorOrnament;
  comments: GalleryCommentOrnament[];
};

/** Hermite smoothstep on a 0..1 unit. */
export function smoothstepUnit(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Sharper than image fade so chips appear when a plane is centered.
 * current: 1 - smoothstep(clamp((blend - 0.15) / 0.35))
 * next: smoothstep(clamp((blend - 0.5) / 0.35))
 * other: 0
 */
export function settleReveal(depthBlend: number, role: OrnamentRole): number {
  const blend = Number.isFinite(depthBlend) ? depthBlend : 0;
  if (role === 'current') {
    return 1 - smoothstepUnit((blend - SETTLE_CURRENT_START) / SETTLE_CURRENT_SPAN);
  }
  if (role === 'next') {
    return smoothstepUnit((blend - SETTLE_NEXT_START) / SETTLE_NEXT_SPAN);
  }
  return 0;
}

export function ornamentRevealForIndex(
  index: number,
  currentIndex: number,
  nextIndex: number,
  depthBlend: number,
): number {
  if (index !== currentIndex && index !== nextIndex) return 0;
  let reveal = 0;
  if (index === currentIndex) reveal = Math.max(reveal, settleReveal(depthBlend, 'current'));
  if (index === nextIndex) reveal = Math.max(reveal, settleReveal(depthBlend, 'next'));
  return reveal;
}

export function ornamentOpacity(planeOpacity: number, reveal: number): number {
  const opacity = (Number.isFinite(planeOpacity) ? planeOpacity : 0) * reveal;
  return clamp(opacity, 0, 1);
}

export function truncateOrnamentText(
  text: string,
  maxChars = GALLERY_ORNAMENT_TEXT_CHARS,
): string {
  const trimmed = (text || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = Math.max(1, maxChars - 1);
  return `${trimmed.slice(0, cut).trimEnd()}…`;
}

export function hashOrnamentUnit(postId: string, entityId: string, salt = ''): number {
  const key = salt ? `${postId}:${entityId}:${salt}` : `${postId}:${entityId}`;
  return hashPostId(key) / 0xffffffff;
}

export function polarPercent(angleDeg: number, radiusPct: number): { leftPct: number; topPct: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    leftPct: 50 + radiusPct * Math.cos(rad),
    topPct: 50 + radiusPct * Math.sin(rad),
  };
}

export function hashedInnerRadiusPct(postId: string, entityId: string): number {
  return INNER_RADIUS_MIN + hashOrnamentUnit(postId, entityId, 'inner-r') * (INNER_RADIUS_MAX - INNER_RADIUS_MIN);
}

function hashedPolar(
  postId: string,
  entityId: string,
  angleMin: number,
  angleMax: number,
  radiusMin: number,
  radiusMax: number,
): PolarSlot {
  const angleDeg = angleMin + hashOrnamentUnit(postId, entityId) * (angleMax - angleMin);
  const radiusPct = radiusMin + hashOrnamentUnit(postId, entityId, 'r') * (radiusMax - radiusMin);
  const innerRadiusPct = hashedInnerRadiusPct(postId, entityId);
  const rest = polarPercent(angleDeg, radiusPct);
  const inner = polarPercent(angleDeg, innerRadiusPct);
  return {
    angleDeg,
    radiusPct,
    leftPct: rest.leftPct,
    topPct: rest.topPct,
    innerRadiusPct,
    innerLeftPct: inner.leftPct,
    innerTopPct: inner.topPct,
  };
}

function isPostReaction(row: CommunityReaction, postId: string): boolean {
  if ((row.postId || '') !== postId) return false;
  if ((row.commentId || '').trim()) return false;
  const unicode = (row.unicode || '').trim();
  const giphyUrl = giphyReactionDisplayUrl(row);
  return Boolean(unicode || giphyUrl);
}

export function selectGalleryReactions(
  reactions: CommunityReaction[],
  postId: string,
): CommunityReaction[] {
  return reactions
    .filter((row) => isPostReaction(row, postId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, GALLERY_ORNAMENT_REACTION_CAP);
}

export function selectGalleryComments(
  comments: CommunityComment[],
  postId: string,
): CommunityComment[] {
  return comments
    .filter((row) => {
      if ((row.postId || '') !== postId) return false;
      if ((row.parentId || '').trim()) return false;
      return (row.status || '').trim() === 'active';
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, GALLERY_ORNAMENT_COMMENT_CAP);
}

export function authorOrnamentFields(
  post: Pick<CommunityPost, 'authorUserId' | 'authorNameSnapshot' | 'body' | 'author'>,
): GalleryAuthorOrnament {
  const linked = post.author;
  const name = (linked?.displayName || post.authorNameSnapshot || '').trim();
  return {
    name,
    body: truncateOrnamentText(post.body || ''),
    profile: {
      displayName: name,
      email: linked?.email || '',
      userId: linked?.userId || post.authorUserId,
      avatarFile: linked?.avatarFile,
      avatarPath: linked?.avatarPath,
      avatarUrl: linked?.avatarUrl,
    },
  };
}

function reactorOrnamentProfile(
  userId: string,
  profiles: ReadonlyMap<string, AvatarProfileFields>,
): AvatarProfileFields {
  const existing = profiles.get(userId);
  if (existing) return existing;
  return { displayName: '', email: '', userId };
}

function commentOrnamentProfile(comment: CommunityComment): AvatarProfileFields {
  const linked = comment.author;
  const name = (linked?.displayName || comment.authorNameSnapshot || '').trim();
  return {
    displayName: name,
    email: linked?.email || '',
    userId: linked?.userId || comment.authorUserId,
    avatarFile: linked?.avatarFile,
    avatarPath: linked?.avatarPath,
    avatarUrl: linked?.avatarUrl,
  };
}

export function buildGalleryOrnamentLayout(input: {
  post: Pick<CommunityPost, 'id' | 'body' | 'authorUserId' | 'authorNameSnapshot' | 'author'>;
  reactions: CommunityReaction[];
  comments: CommunityComment[];
  reactorProfiles: ReadonlyMap<string, AvatarProfileFields>;
}): GalleryOrnamentLayout {
  const { post } = input;
  const reactions = selectGalleryReactions(input.reactions, post.id).map((row) => {
    const polar = hashedPolar(
      post.id,
      row.id,
      REACTION_ANGLE_MIN,
      REACTION_ANGLE_MAX,
      REACTION_RADIUS_MIN,
      REACTION_RADIUS_MAX,
    );
    return {
      ...polar,
      id: row.id,
      unicode: (row.unicode || '').trim(),
      giphyUrl: giphyReactionDisplayUrl(row),
      profile: reactorOrnamentProfile(row.userId, input.reactorProfiles),
    };
  });

  const comments = selectGalleryComments(input.comments, post.id).map((row) => {
    const polar = hashedPolar(
      post.id,
      row.id,
      COMMENT_ANGLE_MIN,
      COMMENT_ANGLE_MAX,
      COMMENT_RADIUS_MIN,
      COMMENT_RADIUS_MAX,
    );
    const profile = commentOrnamentProfile(row);
    return {
      ...polar,
      id: row.id,
      name: profile.displayName,
      body: truncateOrnamentText(row.body || ''),
      profile,
    };
  });

  return {
    reactions,
    author: authorOrnamentFields(post),
    comments,
  };
}
