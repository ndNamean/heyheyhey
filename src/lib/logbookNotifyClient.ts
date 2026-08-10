/**
 * Client helpers for Logbook Admin SDK routes (Stage A submit + Stage B notify).
 */

import { db } from '../db';

export type LogbookNotifyType =
  | 'resolution_submitted'
  | 'creator_update'
  | 'issue_recalled';

export type LogbookDeliveryEventType =
  | 'issue_assigned'
  | 'resolution_submitted'
  | 'ack_required'
  | 'correction_requested'
  | 'approved'
  | 'overdue'
  | 'reopened'
  | 'recalled';

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

/** Stage A — Admin commit (via existing /api/logbook-notify; Hobby function limit). */
export async function postLogbookSubmitResolution(params: {
  entryId: string;
  attemptId: string;
  note: string;
  resolutionNumber: string;
  resolutionChecked: boolean;
  /** Preferred: all proof file ids for this attempt. */
  fileIds?: string[];
  /** Legacy single-file submit; coerced to fileIds on the server. */
  fileId?: string;
}): Promise<LogbookSubmitResolutionResult> {
  try {
    const headers = await getAuthHeaders();
    const fileIds =
      params.fileIds?.filter(Boolean) ??
      (params.fileId ? [params.fileId] : []);
    const resp = await fetch('/api/logbook-notify', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'submit_resolution',
        entryId: params.entryId,
        attemptId: params.attemptId,
        note: params.note,
        resolutionNumber: params.resolutionNumber,
        resolutionChecked: params.resolutionChecked,
        fileIds,
        // Keep legacy key for older clients / debugging.
        fileId: fileIds[0] || '',
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

/** Admin-only inbox, push, and Store Chat delivery for a persisted Logbook event. */
export async function deliverLogbookEvent(params: {
  entryId: string;
  eventType: LogbookDeliveryEventType;
  eventVersion: string;
  note?: string;
  reason?: string;
}): Promise<LogbookNotifyResult> {
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/logbook-notify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'deliver_event', ...params }),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok || !json.ok) {
      return {
        ok: false,
        softFail: true,
        message: typeof json.error === 'string' ? json.error : `Notify failed (${resp.status})`,
      };
    }
    return {
      ok: true,
      created: typeof json.created === 'number' ? json.created : 0,
      deduped: Boolean(json.deduped),
    };
  } catch (e) {
    return { ok: false, softFail: true, message: e instanceof Error ? e.message : 'Notify failed' };
  }
}

export type RemindOverdueChatResult =
  | { ok: true; chatCreated: number; deduped?: boolean }
  | {
      ok: false;
      softFail?: boolean;
      skipped?: boolean;
      reason?: string;
      message: string;
    };

/** Explicit once-only overdue remind → Store Chat (Admin). */
export async function remindOverdueToStoreChat(params: {
  entryId: string;
}): Promise<RemindOverdueChatResult> {
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/logbook-notify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'remind_overdue_chat', entryId: params.entryId }),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = typeof json.reason === 'string' ? json.reason : undefined;
    const skipped = Boolean(json.skipped);

    if (resp.ok && (json.ok || skipped)) {
      if (skipped) {
        return {
          ok: false,
          skipped: true,
          reason,
          message: reason || 'Remind skipped',
        };
      }
      return {
        ok: true,
        chatCreated: typeof json.chatCreated === 'number' ? json.chatCreated : 0,
        deduped: Boolean(json.deduped),
      };
    }

    const message =
      typeof json.error === 'string'
        ? json.error
        : `Remind failed (${resp.status})`;
    return {
      ok: false,
      softFail: resp.status >= 500,
      skipped,
      reason,
      message,
    };
  } catch (e) {
    return {
      ok: false,
      softFail: true,
      message: e instanceof Error ? e.message : 'Remind failed',
    };
  }
}
