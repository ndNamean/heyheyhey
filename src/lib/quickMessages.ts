/**
 * Hardcoded Quick Message templates for chat composer (Phase 4).
 * Insert into draft only — never auto-send.
 * Labels live in i18n `storeChat` (EN + VI).
 */

export const QUICK_MESSAGE_IDS = [
  'onMyWay',
  'gotIt',
  'willCheck',
  'needHelp',
  'almostDone',
  'thanks',
] as const;

export type QuickMessageId = (typeof QUICK_MESSAGE_IDS)[number];

/** i18n key suffix under storeChat (e.g. quickMsgOnMyWay). */
export function quickMessageI18nKey(id: QuickMessageId): `quickMsg${Capitalize<QuickMessageId>}` {
  const capitalized = (id.charAt(0).toUpperCase() + id.slice(1)) as Capitalize<QuickMessageId>;
  return `quickMsg${capitalized}`;
}

export function isQuickMessageId(value: string): value is QuickMessageId {
  return (QUICK_MESSAGE_IDS as readonly string[]).includes(value);
}
