/**
 * Store Operations Leadership flags. Both default OFF.
 * Independent of VITE_GROUP_CHAT and Logbook/Report chat flags.
 */

import { isGroupChatEnabled } from './groupChatFlag';

function isTruthyFlag(raw: unknown): boolean {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

export type StoreOpsLeadershipFlagEnv = {
  VITE_STORE_OPS_LEADERSHIP_CHAT?: unknown;
  STORE_OPS_LEADERSHIP_CHAT?: unknown;
  VITE_STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY?: unknown;
  STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY?: unknown;
};

export function isStoreOpsLeadershipChatEnabled(
  env: StoreOpsLeadershipFlagEnv = import.meta.env,
): boolean {
  return isTruthyFlag(
    env.VITE_STORE_OPS_LEADERSHIP_CHAT ?? env.STORE_OPS_LEADERSHIP_CHAT,
  );
}

export function isStoreOpsLeadershipOversightNotifyEnabled(
  env: StoreOpsLeadershipFlagEnv = import.meta.env,
): boolean {
  return isTruthyFlag(
    env.VITE_STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY ??
      env.STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY,
  );
}

/** Chats surface (selector + membership query) when private groups or leadership rooms are on. */
export function isChatsSurfaceEnabled(
  env: StoreOpsLeadershipFlagEnv & {
    VITE_GROUP_CHAT?: unknown;
    GROUP_CHAT?: unknown;
  } = import.meta.env,
): boolean {
  return isGroupChatEnabled(env) || isStoreOpsLeadershipChatEnabled(env);
}
