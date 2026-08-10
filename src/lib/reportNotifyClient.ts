/**
 * Client helpers for Report → Store Chat Admin delivery via /api/logbook-notify.
 */

import { db } from '../db';

export type ReportDeliveryEventType =
  | 'report_submitted'
  | 'report_action_required'
  | 'report_finalized';

export type ReportNotifyResult =
  | { ok: true; created: number; softFail?: false; deduped?: boolean; chatCreated?: number }
  | { ok: false; softFail: true; message: string };

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Admin-only Store Chat (and Phase 4 mention inbox) for a report lifecycle event. */
export async function deliverReportEvent(params: {
  reportId: string;
  eventType: ReportDeliveryEventType;
  eventVersion: string;
  note?: string;
  itemTitle?: string;
  responseId?: string;
  reportStatus?: string;
}): Promise<ReportNotifyResult> {
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/logbook-notify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'deliver_report_event', ...params }),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok || !json.ok) {
      return {
        ok: false,
        softFail: true,
        message:
          typeof json.error === 'string'
            ? json.error
            : `Notify failed (${resp.status})`,
      };
    }
    return {
      ok: true,
      created: typeof json.created === 'number' ? json.created : 0,
      chatCreated: typeof json.chatCreated === 'number' ? json.chatCreated : 0,
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
