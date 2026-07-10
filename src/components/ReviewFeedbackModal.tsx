import { useEffect, useState } from 'react';
import { useLang } from '../i18n';
import { FEEDBACK_REASONS, type FeedbackCode } from '../lib/feedbackReasons';
import { BACK_PRIORITY, useNativeBack } from '../lib/nativeBack';

export interface FeedbackResult {
  feedbackCode: FeedbackCode;
  feedbackNote: string;
  rejectionReason: string;
}

interface Props {
  open: boolean;
  mode: 'rejected' | 'need_correction';
  itemTitle: string;
  onConfirm: (result: FeedbackResult) => void;
  onCancel: () => void;
}

export default function ReviewFeedbackModal({ open, mode, itemTitle, onConfirm, onCancel }: Props) {
  const { t } = useLang();
  const [code, setCode] = useState<FeedbackCode>('blurry');
  const [freeText, setFreeText] = useState('');
  const [extraNote, setExtraNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode('blurry');
    setFreeText('');
    setExtraNote('');
  }, [open, itemTitle]);

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
      onCancel();
      return true;
    },
    open,
    BACK_PRIORITY.MODAL,
  );

  if (!open) return null;

  function handleConfirm() {
    const trimmedFree = freeText.trim();
    const trimmedNote = extraNote.trim();

    if (code === 'other' && !trimmedFree) {
      alert(t.review.feedbackRequired);
      return;
    }

    const preset = FEEDBACK_REASONS.find((r) => r.code === code)!;
    let rejectionReason: string;
    let feedbackNote: string;

    if (code === 'other') {
      rejectionReason = trimmedFree;
      feedbackNote = trimmedFree;
    } else {
      rejectionReason = trimmedNote ? `${preset.label}\n${trimmedNote}` : preset.label;
      feedbackNote = trimmedNote;
    }

    onConfirm({
      feedbackCode: code,
      feedbackNote,
      rejectionReason,
    });
  }

  const title = mode === 'rejected' ? t.review.rejectItemTitle : t.review.requestCorrectionTitle;

  return (
    <div className="review-feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="review-feedback-title">
      <div className="review-feedback-modal">
        <h2 id="review-feedback-title">{title}</h2>
        <p className="small">{itemTitle}</p>

        <label className="review-feedback-field">
          {t.review.feedbackReason}
          <select value={code} onChange={(e) => setCode(e.target.value as FeedbackCode)}>
            {FEEDBACK_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {code === 'other' ? (
          <label className="review-feedback-field">
            {t.review.yourFeedback}
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t.review.feedbackPlaceholder}
              rows={4}
            />
          </label>
        ) : (
          <label className="review-feedback-field">
            {t.review.feedbackDetail}
            <textarea
              value={extraNote}
              onChange={(e) => setExtraNote(e.target.value)}
              placeholder={t.review.feedbackExtra}
              rows={3}
            />
          </label>
        )}

        <div className="review-feedback-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            {t.common.cancel}
          </button>
          <button type="button" className={mode === 'rejected' ? 'danger' : ''} onClick={handleConfirm}>
            {mode === 'rejected' ? t.review.confirmReject : t.review.sendCorrection}
          </button>
        </div>
      </div>
    </div>
  );
}
