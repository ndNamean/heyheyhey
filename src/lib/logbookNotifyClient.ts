/**
 * Client helpers for Logbook Admin SDK routes (Stage A submit + Stage B notify).
 */

import { db } from '../db';

export type LogbookNotifyType =
  | 'resolution_submitted'
  | 'creator_update'
  | 'issue_recalled';

export type LogbookNotifyResult =
  | { ok: true; created: number; softFail?: false; deduped?: boolean }
  | { ok: false; softFail: true; message: string };

export type LogbookSubmitResolutionResult =
  | { ok: true; deduped?: boolean }
  | { ok: false; message: string };

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Stage A — Admin commit (required when resolution media is attached). */
export async function postLogbookSubmitResolution(params: {
  entryId: string;
  attemptId: string;
  note: string;
  resolutionNumber: string;
  resolutionChecked: boolean;
  fileId?: string;
}): Promise<LogbookSubmitResolutionResult> {
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/logbook-submit-resolution', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entryId: params.entryId,
        attemptId: params.attemptId,
        note: params.note,
        resolutionNumber: params.resolutionNumber,
        resolutionChecked: params.resolutionChecked,
        fileId: params.fileId || '',
      }),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      deduped?: boolean;
      error?: string;
    };
    if (!resp.ok || !data.ok) {
      return {
        ok: false,
        message: data.error || `Submit failed (${resp.status})`,
      };
    }
    return { ok: true, deduped: data.deduped };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Submit failed',
    };
  }
}

export async function postLogbookNotify(params: {
  entryId: string;
  type: LogbookNotifyType;
  attemptId?: string;
  note?: string;
  reason?: string;
}): Promise<LogbookNotifyResult> {
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/logbook-notify', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entryId: params.entryId,
        type: params.type,
        attemptId: params.attemptId,
        resolutionAttemptId: params.attemptId,
        note: params.note,
        reason: params.reason,
      }),
    });
    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!resp.ok) {
      const msg =
        typeof json.error === 'string'
          ? json.error
          : `Notify failed (${resp.status})`;
      return { ok: false, softFail: true, message: msg };
    }
    return {
      ok: true,
      created: typeof json.created === 'number' ? json.created : 0,
      deduped: Boolean(json.deduped),
    };
  } catch (e) {
    return {
      ok: false,
      softFail: true,
      message: e instanceof Error ? e.message : 'Notify failed',
    };
  }
}
