/**
 * Compact overdue → Store Chat remind strip for highlighted Logbook issues.
 */

import type { OverdueChatRemindState } from '../lib/logbookOverdueRemind';

/** Keep in sync with FeedbackInbox OPEN_STORE_CHAT_EVENT. */
const OPEN_STORE_CHAT_EVENT = 'heyPelo:openStoreChat';

export type OverdueRemindPanelCopy = {
  assignedTo: string;
  unassignedBlock: string;
  askRemind: string;
  confirmRemind: string;
  notNow: string;
  alreadyReminded: string;
  openStoreChat: string;
  reminding: string;
};

type Props = {
  state: OverdueChatRemindState;
  mentionLabels: string[];
  remindedAt?: string;
  storeId?: string;
  busy?: boolean;
  copy: OverdueRemindPanelCopy;
  onConfirm: () => void;
  onDismiss: () => void;
};

function formatRemindedAt(iso: string | undefined): string {
  const raw = (iso ?? '').trim();
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString();
  } catch {
    return raw;
  }
}

export default function OverdueRemindPanel({
  state,
  mentionLabels,
  remindedAt,
  storeId,
  busy = false,
  copy,
  onConfirm,
  onDismiss,
}: Props) {
  if (state === 'not_eligible_status') return null;

  const mentions =
    mentionLabels.length > 0
      ? mentionLabels.map((l) => `@${l}`).join(' ')
      : '';

  function openChat() {
    const sid = (storeId ?? '').trim();
    if (!sid || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(OPEN_STORE_CHAT_EVENT, { detail: { storeId: sid } }),
    );
  }

  return (
    <div
      data-testid="overdue-remind-panel"
      style={{
        marginTop: 10,
        padding: '10px 12px',
        border: '1px solid var(--border, #e5e7eb)',
        background: 'var(--surface-2, #f8fafc)',
      }}
    >
      {state === 'unassigned' && (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="overdue-remind-unassigned">
            {copy.unassignedBlock}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button type="button" disabled title={copy.unassignedBlock}>
              {copy.confirmRemind}
            </button>
            <button type="button" className="secondary" onClick={onDismiss}>
              {copy.notNow}
            </button>
          </div>
        </>
      )}

      {state === 'not_reminded' && (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="overdue-remind-assigned">
            {copy.assignedTo.replace('{mentions}', mentions)}
          </p>
          <p className="small" style={{ margin: '6px 0 0' }}>
            {copy.askRemind}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={busy} onClick={onConfirm} data-testid="overdue-remind-confirm">
              {busy ? copy.reminding : copy.confirmRemind}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={onDismiss}>
              {copy.notNow}
            </button>
          </div>
        </>
      )}

      {state === 'reminded' && (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="overdue-remind-already">
            {copy.alreadyReminded}
            {formatRemindedAt(remindedAt) ? ` · ${formatRemindedAt(remindedAt)}` : ''}
          </p>
          {mentions ? (
            <p className="small" style={{ margin: '6px 0 0' }}>
              {copy.assignedTo.replace('{mentions}', mentions)}
            </p>
          ) : null}
          {(storeId ?? '').trim() ? (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="secondary" onClick={openChat} data-testid="overdue-remind-open-chat">
                {copy.openStoreChat}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
