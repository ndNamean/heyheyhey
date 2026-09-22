/**
 * Hashed gallery overlay slots and settle-to-center opacity.
 * Positions depend only on post/entity ids — not depthBlend or scroll direction.
 */

import type { AvatarProfileFields } from '../../../lib/avatarDisplay';
import { commentGiphyDisplayUrl } from '../../../lib/communityCommentGiphy';
import {
  commentHasPhotoContent,
  commentHasVideoContent,
  commentPhotoDisplayUrl,
  commentVideoDisplayUrl,
} from '../../../lib/communityCommentPhoto';
import { isPostReaction } from '../../../lib/communityReactionPeople';
import { commentReactions } from '../../../lib/communityReactions';
import { giphyReactionDisplayUrl } from '../../../lib/storeChatReactions';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import { clamp } from './galleryLayers';
import { hashPostId } from './communityGalleryMoods';

export const GALLERY_ORNAMENT_REACTION_CAP = 8;
export const GALLERY_ORNAMENT_COMMENT_CAP = 6;
export const GALLERY_ORNAMENT_REPLY_CAP = 2;
export const GALLERY_COMMENT_REACTION_BADGE_CAP = 3;
/** Extra polar radius so a reply sits outside its parent on the same ray. */
export const REPLY_RADIUS_STEP = 18;

/** Top hemisphere, clockwise from east (CSS y-down). */
export const REACTION_ANGLE_MIN = 200;
export const REACTION_ANGLE_MAX = 340;
export const REACTION_RADIUS_MIN = 48;
export const REACTION_RADIUS_MAX = 64;

/** Lower hemisphere, clockwise from east. */
export const COMMENT_ANGLE_MIN = 20;
export const COMMENT_ANGLE_MAX = 160;
/** Skip the bottom of the lower arc so 1.4× pills miss the author. */
export const COMMENT_AUTHOR_GAP_MIN = 70;
export const COMMENT_AUTHOR_GAP_MAX = 110;
export const COMMENT_RADIUS_MIN = 62;
export const COMMENT_RADIUS_MAX = 82;

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

export type GalleryCommentReactionBadge = {
  key: string;
  unicode: string;
  giphyUrl: string;
};

export type GalleryCommentOrnament = PolarSlot & {
  id: string;
  name: string;
  body: string;
  /** GIF-as-content thumb. Not a reaction badge. */
  contentGiphyUrl: string;
  /** Photo-as-content thumb. Not a reaction badge. XOR with GIF/video. */
  contentPhotoUrl: string;
  /** Video-as-content thumb. Not a reaction badge. XOR with GIF/photo. */
  contentVideoUrl: string;
  reactionBadges: GalleryCommentReactionBadge[];
  profile: AvatarProfileFields;
};

export type GalleryReplyOrnament = GalleryCommentOrnament & {
  parentId: string;
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
  replies: GalleryReplyOrnament[];
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

export function ornamentOpacity(planeOpacity: number, reveal: number, vanishAmount = 0): number {
  const vanish = clamp(Number.isFinite(vanishAmount) ? vanishAmount : 0, 0, 1);
  const opacity = (Number.isFinite(planeOpacity) ? planeOpacity : 0) * reveal * (1 - vanish);
  return clamp(opacity, 0, 1);
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

/** Midpoints of `count` equal slices on [min, max]. */
export function spaceArcAngles(count: number, min: number, max: number): number[] {
  if (!(count > 0)) return [];
  const slice = (max - min) / count;
  return Array.from({ length: count }, (_, i) => min + (i + 0.5) * slice);
}

/** Even rest angles on the comment arcs, skipping the author gap. */
export function spaceCommentRestAngles(count: number): number[] {
  const leftSpan = COMMENT_AUTHOR_GAP_MIN - COMMENT_ANGLE_MIN;
  const rightSpan = COMMENT_ANGLE_MAX - COMMENT_AUTHOR_GAP_MAX;
  return spaceArcAngles(count, 0, leftSpan + rightSpan).map((t) =>
    t < leftSpan ? COMMENT_ANGLE_MIN + t : COMMENT_AUTHOR_GAP_MAX + (t - leftSpan),
  );
}

export function applySpacedAngles<T extends PolarSlot>(slots: T[], angles: number[]): T[] {
  return slots.map((slot, index) => {
    const angleDeg = angles[index] ?? slot.angleDeg;
    const rest = polarPercent(angleDeg, slot.radiusPct);
    const inner = polarPercent(angleDeg, slot.innerRadiusPct);
    return {
      ...slot,
      angleDeg,
      leftPct: rest.leftPct,
      topPct: rest.topPct,
      innerLeftPct: inner.leftPct,
      innerTopPct: inner.topPct,
    };
  });
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

function isDisplayablePostReaction(row: CommunityReaction, postId: string): boolean {
  if ((row.postId || '') !== postId) return false;
  if (!isPostReaction(row)) return false;
  const unicode = (row.unicode || '').trim();
  const giphyUrl = giphyReactionDisplayUrl(row);
  return Boolean(unicode || giphyUrl);
}

export function selectGalleryReactions(
  reactions: CommunityReaction[],
  postId: string,
): CommunityReaction[] {
  return reactions
    .filter((row) => isDisplayablePostReaction(row, postId))
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

/** Newest 2 active replies per on-screen parent. Hidden, deleted, and off-screen parents are omitted. */
export function selectGalleryReplies(
  comments: CommunityComment[],
  postId: string,
  parentIds: ReadonlySet<string>,
): CommunityComment[] {
  const byParent = new Map<string, CommunityComment[]>();
  for (const row of comments) {
    if ((row.postId || '') !== postId) continue;
    if ((row.status || '').trim() !== 'active') continue;
    const parentId = (row.parentId || '').trim();
    if (!parentId || !parentIds.has(parentId)) continue;
    const bucket = byParent.get(parentId);
    if (bucket) bucket.push(row);
    else byParent.set(parentId, [row]);
  }
  const selected: CommunityComment[] = [];
  for (const parentId of parentIds) {
    const bucket = byParent.get(parentId);
    if (!bucket) continue;
    bucket.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    selected.push(...bucket.slice(0, GALLERY_ORNAMENT_REPLY_CAP));
  }
  return selected;
}

function replyPolar(parent: PolarSlot, index: number): PolarSlot {
  const step = (index + 1) * REPLY_RADIUS_STEP;
  const angleDeg = parent.angleDeg;
  const radiusPct = parent.radiusPct + step;
  const innerRadiusPct = parent.innerRadiusPct + step;
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

/** Top 1–3 reaction groups on a comment pill: count desc, then latest createdAt desc. */
export function selectCommentReactionBadges(
  reactions: CommunityReaction[],
  postId: string,
  commentId: string,
): GalleryCommentReactionBadge[] {
  const groups = new Map<
    string,
    { unicode: string; giphyUrl: string; count: number; latest: string }
  >();
  for (const row of commentReactions(reactions, postId, commentId)) {
    const unicode = (row.unicode || '').trim();
    const giphyId = (row.giphyId || '').trim();
    const giphyUrl = giphyReactionDisplayUrl(row);
    if (!unicode && !giphyUrl) continue;
    const key = unicode ? `unicode:${unicode}` : `giphy:${giphyId || giphyUrl}`;
    const existing = groups.get(key);
    const created = row.createdAt || '';
    if (!existing) {
      groups.set(key, { unicode, giphyUrl, count: 1, latest: created });
      continue;
    }
    existing.count += 1;
    if (created.localeCompare(existing.latest) > 0) {
      existing.latest = created;
      if (giphyUrl) existing.giphyUrl = giphyUrl;
    }
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      const recency = b[1].latest.localeCompare(a[1].latest);
      if (recency !== 0) return recency;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, GALLERY_COMMENT_REACTION_BADGE_CAP)
    .map(([key, group]) => ({
      key,
      unicode: group.unicode,
      giphyUrl: group.giphyUrl,
    }));
}

export function authorOrnamentFields(
  post: Pick<CommunityPost, 'authorUserId' | 'authorNameSnapshot' | 'body' | 'author'>,
): GalleryAuthorOrnament {
  const linked = post.author;
  const name = (linked?.displayName || post.authorNameSnapshot || '').trim();
  return {
    name,
    body: post.body || '',
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

function commentOrnamentFromRow(
  row: CommunityComment,
  polar: PolarSlot,
  reactions: CommunityReaction[],
  postId: string,
): GalleryCommentOrnament {
  const profile = commentOrnamentProfile(row);
  const contentGiphyUrl = commentGiphyDisplayUrl(row);
  const contentPhotoUrl =
    contentGiphyUrl || !commentHasPhotoContent(row) ? '' : commentPhotoDisplayUrl(row);
  const contentVideoUrl =
    contentGiphyUrl || contentPhotoUrl || !commentHasVideoContent(row)
      ? ''
      : commentVideoDisplayUrl(row);
  return {
    ...polar,
    id: row.id,
    name: profile.displayName,
    body: row.body || '',
    contentGiphyUrl,
    contentPhotoUrl,
    contentVideoUrl,
    reactionBadges: selectCommentReactionBadges(reactions, postId, row.id),
    profile,
  };
}

export function buildGalleryOrnamentLayout(input: {
  post: Pick<CommunityPost, 'id' | 'body' | 'authorUserId' | 'authorNameSnapshot' | 'author'>;
  reactions: CommunityReaction[];
  comments: CommunityComment[];
  reactorProfiles: ReadonlyMap<string, AvatarProfileFields>;
}): GalleryOrnamentLayout {
  const { post } = input;
  const reactionSlots = selectGalleryReactions(input.reactions, post.id).map((row) => {
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
  const reactions = applySpacedAngles(
    reactionSlots,
    spaceArcAngles(reactionSlots.length, REACTION_ANGLE_MIN, REACTION_ANGLE_MAX),
  );

  const commentSlots = selectGalleryComments(input.comments, post.id).map((row) => {
    const polar = hashedPolar(
      post.id,
      row.id,
      COMMENT_ANGLE_MIN,
      COMMENT_ANGLE_MAX,
      COMMENT_RADIUS_MIN,
      COMMENT_RADIUS_MAX,
    );
    return commentOrnamentFromRow(row, polar, input.reactions, post.id);
  });
  const commentsById = [...commentSlots].sort((a, b) => a.id.localeCompare(b.id));
  const spacedComments = applySpacedAngles(commentsById, spaceCommentRestAngles(commentsById.length));
  const commentById = new Map(spacedComments.map((row) => [row.id, row]));
  const comments = commentSlots.map((row) => commentById.get(row.id) ?? row);

  const parentIds = new Set(comments.map((row) => row.id));
  const replyIndexByParent = new Map<string, number>();
  const replies: GalleryReplyOrnament[] = [];
  for (const row of selectGalleryReplies(input.comments, post.id, parentIds)) {
    const parentId = (row.parentId || '').trim();
    const parent = commentById.get(parentId);
    if (!parent) continue;
    const index = replyIndexByParent.get(parentId) ?? 0;
    replyIndexByParent.set(parentId, index + 1);
    replies.push({
      ...commentOrnamentFromRow(row, replyPolar(parent, index), input.reactions, post.id),
      parentId,
    });
  }

  return {
    reactions,
    author: authorOrnamentFields(post),
    comments,
    replies,
  };
}
