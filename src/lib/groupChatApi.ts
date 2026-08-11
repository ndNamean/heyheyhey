/**
 * Client helper for Custom Group Chat Admin actions (folded into /api/invites).
 */

import { db } from '../db';

export type GroupChatApiAction =
  | 'groupChatCreate'
  | 'groupChatInvite'
  | 'groupChatAccept'
  | 'groupChatDecline'
  | 'groupChatCancel'
  | 'groupChatRemind'
  | 'groupChatArchive'
  | 'groupChatRename'
  | 'groupChatRemoveMember'
  | 'groupChatLeave'
  | 'groupChatListPending';

async function authHeaders() {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function groupChatApi<T = Record<string, unknown>>(
  action: GroupChatApiAction,
  body: Record<string, unknown> = {},
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const headers = await authHeaders();
  const url = `/api/invites?action=${encodeURIComponent(action)}`;
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify({ action, ...body }),
  });
  const text = await res.text();
  let data: T & { error?: string } = {} as T & { error?: string };
  if (text) {
    try {
      data = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error(res.ok ? 'Invalid server response' : `Request failed (${res.status})`);
    }
  }
  if (!res.ok) {
    throw new Error(data.error || `Group chat request failed (${res.status})`);
  }
  return data;
}
