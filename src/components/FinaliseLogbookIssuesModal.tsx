import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { BACK_PRIORITY, useNativeBack } from '../lib/nativeBack';
import { defaultFinaliseIssueDueLocal } from '../lib/finaliseLogbookIssues';
import type { LogSeverity, MediaRecord, Report, ReportResponse } from '../types';
import ProofPhoto from './ProofPhoto';

export interface FinaliseLogbookIssuesConfirm {
  selectedResponseIds: string[];
  dueAtLocal: string;
  severity: LogSeverity;
}

interface Props {
  open: boolean;
  report: Report | null;
  items: ReportResponse[];
  onConfirm: (result: FinaliseLogbookIssuesConfirm) => void;
  onSkip: () => void;
}

export default function FinaliseLogbookIssuesModal({
  open,
  report,
  items,
  onConfirm,
  onSkip,
}: Props) {
  const { t } = useLang();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dueAtLocal, setDueAtLocal] = useState('');
  const [severity, setSeverity] = useState<LogSeverity>('warning');

  const itemIdsKey = useMemo(() => items.map((i) => i.id).join(','), [items]);

  useEffect(() => {
    if (!open || !report) return;
    setSelectedIds(items.map((i) => i.id));
    setDueAtLocal(defaultFinaliseIssueDueLocal(report.reportDate));
    setSeverity('warning');
  }, [open, report, itemIdsKey, items]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useNativeBack(
    () => {
      onSkip();
      return true;
    },
    open,
    BACK_PRIORITY.MODAL,
  );

  if (!open || !report) return null;

  function toggleId(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleConfirm() {
    if (!dueAtLocal.trim()) {
      alert(t.logbook.dueRequired);
      return;
    }
    const dueMs = new Date(dueAtLocal).getTime();
    if (!Number.isFinite(dueMs)) {
      alert(t.logbook.dueRequired);
      return;
    }
    onConfirm({
      selectedResponseIds: selectedIds,
      dueAtLocal,
      severity,
    });
  }

  return (
    <div
      className="review-feedback-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finalise-logbook-issues-title"
    >
      <div className="review-feedback-modal finalise-logbook-issues-modal">
        <h2 id="finalise-logbook-issues-title">{t.review.createLogbookIssuesTitle}</h2>
        <p className="small">{t.review.createLogbookIssuesSubtitle}</p>

        <div className="finalise-logbook-issues-list">
          {items.map((item) => {
            const media = (item.media ?? []) as MediaRecord[];
            const checked = selectedIds.includes(item.id);
            return (
              <label key={item.id} className="finalise-logbook-issue-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleId(item.id)}
                />
                <div className="finalise-logbook-issue-body">
                  <div className="finalise-logbook-issue-title">{item.title}</div>
                  {item.rejectionReason ? (
                    <p className="small finalise-logbook-issue-note">{item.rejectionReason}</p>
                  ) : null}
                  {media.length > 0 && (
                    <div className="proof-photo-grid finalise-logbook-issue-thumbs">
                      {media.slice(0, 3).map((m) => (
                        <div className="proof-photo-card" key={m.id}>
                          <ProofPhoto
                            media={m}
                            reviewContext={{
                              storeCode: report.storeCode,
                              itemTitle: item.title,
                              watermarked: m.watermarked,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <label className="review-feedback-field">
          {t.logbook.dueAt}
          <input
            type="datetime-local"
            value={dueAtLocal}
            onChange={(e) => setDueAtLocal(e.target.value)}
            required
          />
        </label>

        <label className="review-feedback-field">
          {t.common.severity}
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as LogSeverity)}
          >
            {(['info', 'warning', 'critical'] as LogSeverity[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="review-feedback-actions">
          <button type="button" className="secondary" onClick={onSkip}>
            {t.review.skipLogbookIssues}
          </button>
          <button type="button" className="success" onClick={handleConfirm}>
            {t.review.confirmLogbookIssues}
          </button>
        </div>
      </div>
    </div>
  );
}
