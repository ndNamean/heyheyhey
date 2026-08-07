/**
 * Unified chat message action registry (Store Chat + Group Chat).
 * Capabilities, labels, keyboard maps — room-agnostic.
 */

export type StoreChatActionId =
  | 'reply'
  | 'react'
  | 'copy'
  | 'forward'
  | 'favorite'
  | 'translate'
  | 'delete'
  | 'more';

/** Alias for Group Chat / shared panels. */
export type ChatActionId = StoreChatActionId;

export interface StoreChatActionCapabilityContext {
  isOwn: boolean;
  isDeleted: boolean;
  canSend: boolean;
  canReact: boolean;
  hasBody: boolean;
  translationAvailable: boolean;
  isBookmarked: boolean;
  /** At least one other authorized destination to forward into. */
  canForward: boolean;
  /** Logbook/system rows: Reply/React ok; hide Forward/Delete. */
  isLogbookSystem?: boolean;
  /** Group system messages — same spirit as logbook cards. */
  isSystemMessage?: boolean;
}

export type ChatActionCapabilityContext = StoreChatActionCapabilityContext;

export interface StoreChatActionDef {
  id: StoreChatActionId;
  label: string;
  /** Lowercase key when message row is focused (no modifiers). */
  keyboard?: string;
  destructive?: boolean;
  /** Desktop hover/focus strip. */
  strip?: boolean;
  /** Mobile long-press sheet. */
  sheet?: boolean;
  /** Items revealed under More. */
  moreMenu?: boolean;
}

export const STORE_CHAT_ACTIONS: readonly StoreChatActionDef[] = [
  { id: 'react', label: 'React', strip: true, sheet: true },
  { id: 'reply', label: 'Reply', keyboard: 'r', strip: true, sheet: true },
  { id: 'more', label: 'More', strip: true },
  { id: 'copy', label: 'Copy', keyboard: 'c', sheet: true, moreMenu: true },
  { id: 'forward', label: 'Forward', sheet: true, moreMenu: true },
  { id: 'favorite', label: 'Favorite', sheet: true, moreMenu: true },
  { id: 'translate', label: 'Translate', sheet: true, moreMenu: true },
  {
    id: 'delete',
    label: 'Delete',
    destructive: true,
    sheet: true,
    moreMenu: true,
  },
] as const;

export const CHAT_ACTIONS = STORE_CHAT_ACTIONS;

const ACTION_BY_ID = new Map(STORE_CHAT_ACTIONS.map((a) => [a.id, a]));

export function getStoreChatAction(id: StoreChatActionId): StoreChatActionDef {
  const def = ACTION_BY_ID.get(id);
  if (!def) throw new Error(`Unknown store chat action: ${id}`);
  return def;
}

export const getChatAction = getStoreChatAction;

export type StoreChatActionLabelCopy = {
  reply: string;
  react: string;
  more: string;
  copy: string;
  forward: string;
  favorite: string;
  removeFavorite: string;
  translate: string;
  delete: string;
};

const DEFAULT_ACTION_LABELS: StoreChatActionLabelCopy = {
  reply: 'Reply',
  react: 'React',
  more: 'More',
  copy: 'Copy',
  forward: 'Forward',
  favorite: 'Favorite',
  removeFavorite: 'Remove favorite',
  translate: 'Translate',
  delete: 'Delete',
};

export function favoriteActionLabel(
  isBookmarked: boolean,
  copy: Pick<StoreChatActionLabelCopy, 'favorite' | 'removeFavorite'> = DEFAULT_ACTION_LABELS,
): string {
  return isBookmarked ? copy.removeFavorite : copy.favorite;
}

export function storeChatActionLabel(
  id: StoreChatActionId,
  ctx: Pick<StoreChatActionCapabilityContext, 'isBookmarked'>,
  copy: StoreChatActionLabelCopy = DEFAULT_ACTION_LABELS,
): string {
  if (id === 'favorite') return favoriteActionLabel(ctx.isBookmarked, copy);
  return copy[id] ?? getStoreChatAction(id).label;
}

export const chatActionLabel = storeChatActionLabel;

function isProtectedSystem(ctx: StoreChatActionCapabilityContext): boolean {
  return Boolean(ctx.isLogbookSystem || ctx.isSystemMessage);
}

/**
 * Whether an action is available for the given message/viewer context.
 * `more` is a UI affordance and is available when any moreMenu action is.
 */
export function isStoreChatActionAvailable(
  actionId: StoreChatActionId,
  ctx: StoreChatActionCapabilityContext,
): boolean {
  if (actionId === 'more') {
    return STORE_CHAT_ACTIONS.some(
      (a) => a.moreMenu && isStoreChatActionAvailable(a.id, ctx),
    );
  }

  if (ctx.isDeleted) return false;

  switch (actionId) {
    case 'reply':
      return ctx.canSend;
    case 'react':
      return ctx.canReact;
    case 'copy':
      return ctx.hasBody;
    case 'forward':
      if (isProtectedSystem(ctx)) return false;
      return ctx.canSend && ctx.canForward && ctx.hasBody;
    case 'favorite':
      return true;
    case 'translate':
      return ctx.translationAvailable && ctx.hasBody;
    case 'delete':
      if (isProtectedSystem(ctx)) return false;
      return ctx.isOwn;
    default: {
      const _exhaustive: never = actionId;
      return _exhaustive;
    }
  }
}

export const isChatActionAvailable = isStoreChatActionAvailable;

export function listStoreChatActions(
  surface: 'strip' | 'sheet' | 'moreMenu',
  ctx: StoreChatActionCapabilityContext,
  labels: StoreChatActionLabelCopy = DEFAULT_ACTION_LABELS,
): StoreChatActionDef[] {
  return STORE_CHAT_ACTIONS.filter((a) => {
    if (surface === 'strip' && !a.strip) return false;
    if (surface === 'sheet' && !a.sheet) return false;
    if (surface === 'moreMenu' && !a.moreMenu) return false;
    return isStoreChatActionAvailable(a.id, ctx);
  }).map((a) => ({
    ...a,
    label: storeChatActionLabel(a.id, ctx, labels),
  }));
}

export const listChatActions = listStoreChatActions;

/** Map a bare key (no modifiers) to an action id when the message row is focused. */
export function resolveStoreChatActionKeyboard(
  key: string,
  ctx: StoreChatActionCapabilityContext,
): StoreChatActionId | null {
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  for (const action of STORE_CHAT_ACTIONS) {
    if (!action.keyboard || action.keyboard !== normalized) continue;
    if (!isStoreChatActionAvailable(action.id, ctx)) continue;
    return action.id;
  }
  return null;
}

export const resolveChatActionKeyboard = resolveStoreChatActionKeyboard;
