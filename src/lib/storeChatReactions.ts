import type { GiphyMediaItem } from './giphyClient';
import type { StoreChatReaction } from '../types';

/** Quick-tray Unicode set for Phase 2 (GIPHY reactions land in Phase 5). */
export const QUICK_UNICODE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type QuickUnicodeReaction = (typeof QUICK_UNICODE_REACTIONS)[number];

export interface ReactionIdentityInput {
  messageId: string;
  userId: string;
  reactionType: string;
  unicode?: string;
  giphyId?: string;
}

export type EmptyGiphyReactionFields = {
  giphyId: string;
  giphyKind: string;
  giphyTitle: string;
  giphyUrl: string;
  giphyPreviewUrl: string;
};

export const EMPTY_GIPHY_REACTION_FIELDS: EmptyGiphyReactionFields = {
  giphyId: '',
  giphyKind: '',
  giphyTitle: '',
  giphyUrl: '',
  giphyPreviewUrl: '',
};

export type UnicodeReactionToggleDecision =
  | {
      action: 'add';
      identityKey: string;
      clientMutationId: string;
      payload: {
        messageId: string;
        userId: string;
        reactionType: 'unicode';
        unicode: string;
        giphyId: string;
        giphyKind: string;
        giphyTitle: string;
        giphyUrl: string;
        giphyPreviewUrl: string;
      };
    }
  | {
      action: 'remove';
      identityKey: string;
      reactionId: string;
      clientMutationId: string;
    };

export type GiphyReactionToggleDecision =
  | {
      action: 'add';
      identityKey: string;
      clientMutationId: string;
      payload: {
        messageId: string;
        userId: string;
        reactionType: 'giphy';
        unicode: string;
        giphyId: string;
        giphyKind: string;
        giphyTitle: string;
        giphyUrl: string;
        giphyPreviewUrl: string;
      };
    }
  | {
      action: 'remove';
      identityKey: string;
      reactionId: string;
      clientMutationId: string;
    };

export interface UnicodeReactionGroup {
  unicode: string;
  count: number;
  userIds: string[];
  reactedByMe: boolean;
  myReactionId: string | null;
  /** Oldest-first for stable chip order within a group. */
  reactions: StoreChatReaction[];
}

export interface GiphyReactionGroup {
  giphyId: string;
  giphyKind: string;
  giphyTitle: string;
  giphyUrl: string;
  giphyPreviewUrl: string;
  count: number;
  userIds: string[];
  reactedByMe: boolean;
  myReactionId: string | null;
  reactions: StoreChatReaction[];
}

function normalizeUnicode(unicode: string): string {
  return unicode.normalize('NFC').trim();
}

/** Stable identity for idempotent toggle / dedupe across clients. */
export function buildReactionIdentityKey(input: ReactionIdentityInput): string {
  const messageId = input.messageId.trim();
  const userId = input.userId.trim();
  const reactionType = (input.reactionType || '').trim().toLowerCase();
  if (reactionType === 'unicode') {
    return `unicode:${messageId}:${userId}:${normalizeUnicode(input.unicode ?? '')}`;
  }
  if (reactionType === 'giphy') {
    return `giphy:${messageId}:${userId}:${(input.giphyId ?? '').trim()}`;
  }
  return `${reactionType}:${messageId}:${userId}`;
}

export function buildUnicodeReactionIdentityKey(
  messageId: string,
  userId: string,
  unicode: string,
): string {
  return buildReactionIdentityKey({
    messageId,
    userId,
    reactionType: 'unicode',
    unicode,
  });
}

/** Deterministic clientMutationId so retries of the same toggle are idempotent. */
export function buildUnicodeReactionMutationId(
  messageId: string,
  userId: string,
  unicode: string,
  action: 'add' | 'remove',
): string {
  return `${action}:${buildUnicodeReactionIdentityKey(messageId, userId, unicode)}`;
}

export function buildGiphyReactionIdentityKey(
  messageId: string,
  userId: string,
  giphyId: string,
): string {
  return buildReactionIdentityKey({
    messageId,
    userId,
    reactionType: 'giphy',
    giphyId,
  });
}

export function buildGiphyReactionMutationId(
  messageId: string,
  userId: string,
  giphyId: string,
  action: 'add' | 'remove',
): string {
  return `${action}:${buildGiphyReactionIdentityKey(messageId, userId, giphyId)}`;
}

export function isUnicodeReaction(reaction: Pick<StoreChatReaction, 'reactionType' | 'unicode'>): boolean {
  return reaction.reactionType === 'unicode' && Boolean(normalizeUnicode(reaction.unicode || ''));
}

export function isGiphyReaction(
  reaction: Pick<StoreChatReaction, 'reactionType' | 'giphyId'>,
): boolean {
  return reaction.reactionType === 'giphy' && Boolean((reaction.giphyId || '').trim());
}

/** Fallback CDN preview when historical rows lack stored URLs. */
export function giphyReactionDisplayUrl(
  reaction: Pick<StoreChatReaction, 'giphyId' | 'giphyUrl' | 'giphyPreviewUrl'>,
): string {
  const preview = (reaction.giphyPreviewUrl || '').trim();
  if (preview) return preview;
  const url = (reaction.giphyUrl || '').trim();
  if (url) return url;
  const id = (reaction.giphyId || '').trim();
  return id ? `https://media.giphy.com/media/${id}/200.gif` : '';
}

export function findOwnUnicodeReaction(
  reactions: StoreChatReaction[],
  messageId: string,
  userId: string,
  unicode: string,
): StoreChatReaction | undefined {
  const normalized = normalizeUnicode(unicode);
  return reactions.find(
    (r) =>
      r.messageId === messageId &&
      r.userId === userId &&
      isUnicodeReaction(r) &&
      normalizeUnicode(r.unicode) === normalized,
  );
}

export function findOwnGiphyReaction(
  reactions: StoreChatReaction[],
  messageId: string,
  userId: string,
  giphyId: string,
): StoreChatReaction | undefined {
  const id = giphyId.trim();
  return reactions.find(
    (r) =>
      r.messageId === messageId &&
      r.userId === userId &&
      isGiphyReaction(r) &&
      (r.giphyId || '').trim() === id,
  );
}

/**
 * Pure toggle resolver: if the viewer already has this Unicode on the message,
 * remove it; otherwise add. Identity is message+user+unicode.
 */
export function resolveUnicodeReactionToggle(
  existing: StoreChatReaction[],
  params: { messageId: string; userId: string; unicode: string },
): UnicodeReactionToggleDecision {
  const messageId = params.messageId.trim();
  const userId = params.userId.trim();
  const unicode = normalizeUnicode(params.unicode);
  const identityKey = buildUnicodeReactionIdentityKey(messageId, userId, unicode);

  if (!messageId || !userId || !unicode) {
    throw new Error('Invalid unicode reaction toggle params');
  }

  const own = findOwnUnicodeReaction(existing, messageId, userId, unicode);
  if (own) {
    return {
      action: 'remove',
      identityKey,
      reactionId: own.id,
      clientMutationId: buildUnicodeReactionMutationId(messageId, userId, unicode, 'remove'),
    };
  }

  return {
    action: 'add',
    identityKey,
    clientMutationId: buildUnicodeReactionMutationId(messageId, userId, unicode, 'add'),
    payload: {
      messageId,
      userId,
      reactionType: 'unicode',
      unicode,
      ...EMPTY_GIPHY_REACTION_FIELDS,
    },
  };
}

/**
 * Pure toggle resolver for GIPHY reactions. Identity is message+user+giphyId.
 * Pass the staged picker item on add; remove only needs giphyId.
 */
export function resolveGiphyReactionToggle(
  existing: StoreChatReaction[],
  params: {
    messageId: string;
    userId: string;
    giphyId: string;
    item?: GiphyMediaItem | null;
  },
): GiphyReactionToggleDecision {
  const messageId = params.messageId.trim();
  const userId = params.userId.trim();
  const giphyId = (params.giphyId || params.item?.id || '').trim();
  const identityKey = buildGiphyReactionIdentityKey(messageId, userId, giphyId);

  if (!messageId || !userId || !giphyId) {
    throw new Error('Invalid giphy reaction toggle params');
  }

  const own = findOwnGiphyReaction(existing, messageId, userId, giphyId);
  if (own) {
    return {
      action: 'remove',
      identityKey,
      reactionId: own.id,
      clientMutationId: buildGiphyReactionMutationId(messageId, userId, giphyId, 'remove'),
    };
  }

  const item = params.item;
  if (item?.id?.trim() && item.id.trim() === giphyId) {
    return {
      action: 'add',
      identityKey,
      clientMutationId: buildGiphyReactionMutationId(messageId, userId, giphyId, 'add'),
      payload: {
        messageId,
        userId,
        reactionType: 'giphy',
        unicode: '',
        giphyId,
        giphyKind: item.kind,
        giphyTitle: item.title.trim() || 'GIPHY',
        giphyUrl: item.url.trim(),
        giphyPreviewUrl: (item.previewUrl || item.url).trim(),
      },
    };
  }

  // Join an existing group from a chip click (no picker item).
  const peer = existing.find(
    (r) =>
      r.messageId === messageId &&
      isGiphyReaction(r) &&
      (r.giphyId || '').trim() === giphyId,
  );
  if (!peer) {
    throw new Error('GIPHY reaction add requires media item or existing group');
  }
  const preview = giphyReactionDisplayUrl(peer);
  const url = (peer.giphyUrl || '').trim() || preview;
  if (!url) {
    throw new Error('GIPHY reaction add requires a media URL');
  }

  return {
    action: 'add',
    identityKey,
    clientMutationId: buildGiphyReactionMutationId(messageId, userId, giphyId, 'add'),
    payload: {
      messageId,
      userId,
      reactionType: 'giphy',
      unicode: '',
      giphyId,
      giphyKind: peer.giphyKind || 'gif',
      giphyTitle: peer.giphyTitle || 'GIPHY',
      giphyUrl: url,
      giphyPreviewUrl: preview || url,
    },
  };
}

/** Room-batched reactions → per-message lists (stable createdAt ascending). */
export function mapReactionsByMessageId(
  reactions: StoreChatReaction[],
): Map<string, StoreChatReaction[]> {
  const map = new Map<string, StoreChatReaction[]>();
  for (const reaction of reactions) {
    if (!reaction.messageId) continue;
    const list = map.get(reaction.messageId);
    if (list) list.push(reaction);
    else map.set(reaction.messageId, [reaction]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  return map;
}

/**
 * Group Unicode reactions for chip UI. One chip per distinct emoji;
 * count / reactedByMe derived from membership.
 */
export function groupUnicodeReactions(
  reactions: StoreChatReaction[],
  currentUserId: string,
): UnicodeReactionGroup[] {
  const byUnicode = new Map<string, StoreChatReaction[]>();
  for (const reaction of reactions) {
    if (!isUnicodeReaction(reaction)) continue;
    const key = normalizeUnicode(reaction.unicode);
    const list = byUnicode.get(key);
    if (list) list.push(reaction);
    else byUnicode.set(key, [reaction]);
  }

  const groups: UnicodeReactionGroup[] = [];
  for (const [unicode, list] of byUnicode) {
    const sorted = list
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const userIds = dedupeUserIds(sorted.map((r) => r.userId));
    const mine = sorted.find((r) => r.userId === currentUserId) ?? null;
    groups.push({
      unicode,
      count: userIds.length,
      userIds,
      reactedByMe: Boolean(mine),
      myReactionId: mine?.id ?? null,
      reactions: sorted,
    });
  }

  // Stable chip order: first-seen emoji (by earliest reaction), then unicode.
  groups.sort((a, b) => {
    const aAt = a.reactions[0]?.createdAt ?? '';
    const bAt = b.reactions[0]?.createdAt ?? '';
    return aAt.localeCompare(bAt) || a.unicode.localeCompare(b.unicode);
  });
  return groups;
}

/**
 * Group GIPHY reactions for chip UI. One chip per distinct giphyId;
 * count / reactedByMe derived from membership.
 */
export function groupGiphyReactions(
  reactions: StoreChatReaction[],
  currentUserId: string,
): GiphyReactionGroup[] {
  const byId = new Map<string, StoreChatReaction[]>();
  for (const reaction of reactions) {
    if (!isGiphyReaction(reaction)) continue;
    const key = (reaction.giphyId || '').trim();
    const list = byId.get(key);
    if (list) list.push(reaction);
    else byId.set(key, [reaction]);
  }

  const groups: GiphyReactionGroup[] = [];
  for (const [giphyId, list] of byId) {
    const sorted = list
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const userIds = dedupeUserIds(sorted.map((r) => r.userId));
    const mine = sorted.find((r) => r.userId === currentUserId) ?? null;
    const exemplar = mine ?? sorted[0];
    groups.push({
      giphyId,
      giphyKind: exemplar?.giphyKind || '',
      giphyTitle: exemplar?.giphyTitle || 'GIPHY',
      giphyUrl: exemplar?.giphyUrl || '',
      giphyPreviewUrl: giphyReactionDisplayUrl(exemplar ?? { giphyId, giphyUrl: '', giphyPreviewUrl: '' }),
      count: userIds.length,
      userIds,
      reactedByMe: Boolean(mine),
      myReactionId: mine?.id ?? null,
      reactions: sorted,
    });
  }

  groups.sort((a, b) => {
    const aAt = a.reactions[0]?.createdAt ?? '';
    const bAt = b.reactions[0]?.createdAt ?? '';
    return aAt.localeCompare(bAt) || a.giphyId.localeCompare(b.giphyId);
  });
  return groups;
}

/** Deduplicate user ids while preserving first-seen order (who-reacted lists). */
export function dedupeUserIds(userIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of userIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Merge reactor lists across groups without duplicates (notification/recipient helpers). */
export function dedupeReactionRecipients(
  ...groups: Array<Iterable<string> | null | undefined>
): string[] {
  const merged: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const id of group) merged.push(id);
  }
  return dedupeUserIds(merged);
}

export function isQuickUnicodeReaction(unicode: string): unicode is QuickUnicodeReaction {
  const normalized = normalizeUnicode(unicode);
  return (QUICK_UNICODE_REACTIONS as readonly string[]).includes(normalized);
}
