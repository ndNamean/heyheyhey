import { db } from '../db';

async function authHeaders() {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJson(resp: Response) {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`);
    }
  }
  if (!resp.ok) {
    throw Object.assign(new Error(String(data.error || `Request failed (${resp.status})`)), {
      status: resp.status,
      data,
    });
  }
  return data;
}

export async function createInvitation(params: {
  email: string;
  role: string;
  storeIds?: string[];
  origin?: string;
}) {
  const headers = await authHeaders();
  const resp = await fetch('/api/invites?action=create', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: params.email,
      role: params.role,
      storeIds: params.storeIds ?? [],
      origin: params.origin ?? window.location.origin,
    }),
  });
  return parseJson(resp);
}

export async function validateInvitation(token: string) {
  const resp = await fetch(`/api/invites?action=validate&token=${encodeURIComponent(token)}`);
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid server response');
    }
  }
  return { ok: resp.ok, status: resp.status, data };
}

export async function acceptInvitation(token: string) {
  const headers = await authHeaders();
  const resp = await fetch('/api/invites?action=accept', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token }),
  });
  return parseJson(resp);
}

export async function listInvitations() {
  const headers = await authHeaders();
  const resp = await fetch('/api/invites?action=list', { headers });
  return parseJson(resp);
}

export async function resendInvitation(invitationId: string, origin?: string) {
  const headers = await authHeaders();
  const resp = await fetch('/api/invites?action=resend', {
    method: 'POST',
    headers,
    body: JSON.stringify({ invitationId, origin: origin ?? window.location.origin }),
  });
  return parseJson(resp);
}

export async function revokeInvitation(invitationId: string) {
  const headers = await authHeaders();
  const resp = await fetch('/api/invites?action=revoke', {
    method: 'POST',
    headers,
    body: JSON.stringify({ invitationId }),
  });
  return parseJson(resp);
}

const TOKEN_KEY = 'pendingInviteToken';

export function stashInviteToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function readStashedInviteToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function clearStashedInviteToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
