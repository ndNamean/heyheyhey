import { useEffect, useState } from 'react';
import { FEEDBACK_REASONS, type FeedbackCode } from '../lib/feedbackReasons';

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

  if (!open) return null;

  function handleConfirm() {
    const trimmedFree = freeText.trim();
    const trimmedNote = extraNote.trim();

    if (code === 'other' && !trimmedFree) {
      alert('Please enter your feedback.');
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

  const title = mode === 'rejected' ? 'Reject item' : 'Request correction';

  return (
    <div className="review-feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="review-feedback-title">
      <div className="review-feedback-modal">
        <h2 id="review-feedback-title">{title}</h2>
        <p className="small">{itemTitle}</p>

        <label className="review-feedback-field">
          Feedback reason
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
            Your feedback
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Describe what needs to be fixed…"
              rows={4}
            />
          </label>
        ) : (
          <label className="review-feedback-field">
            Additional note (optional)
            <textarea
              value={extraNote}
              onChange={(e) => setExtraNote(e.target.value)}
              placeholder="Extra detail for the submitter…"
              rows={3}
            />
          </label>
        )}

        <div className="review-feedback-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={mode === 'rejected' ? 'danger' : ''} onClick={handleConfirm}>
            {mode === 'rejected' ? 'Confirm reject' : 'Send correction'}
          </button>
        </div>
      </div>
    </div>
  );
}
