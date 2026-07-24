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

/** Owner-only hard removal of a rejected profile via trusted Admin API. */
export async function removeUserFromSystem(profileId: string) {
  const headers = await authHeaders();
  const resp = await fetch('/api/remove-user', {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId }),
  });
  return parseJson(resp);
}
