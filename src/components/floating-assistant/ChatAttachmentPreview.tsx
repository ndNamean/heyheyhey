import type { StagedChatAttachment, ChatAttachmentStagePhase } from './useChatAttachmentStaging';
import './chatAttachments.css';

export type ChatAttachmentPreviewProps = {
  item: StagedChatAttachment;
  phase?: ChatAttachmentStagePhase;
  uploadProgress?: number;
  hint?: string;
  statusLabel?: string;
  onClear?: () => void;
  onRetry?: () => void;
  removeLabel?: string;
  retryLabel?: string;
  previewAriaLabel?: string;
  className?: string;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Composer selection preview for staged photo/file — mirror GiphyMediaPreview.
 * Does not send; parent clears via onClear or after successful Instant write.
 */
export function ChatAttachmentPreview({
  item,
  phase = 'selected',
  uploadProgress = 0,
  hint = 'Ready to send — tap Send when ready',
  statusLabel,
  onClear,
  onRetry,
  removeLabel = 'Remove attachment',
  retryLabel = 'Retry',
  previewAriaLabel,
  className,
}: ChatAttachmentPreviewProps) {
  const rootClass = ['chat-attachment-preview', className].filter(Boolean).join(' ');
  const title =
    item.kind === 'image' ? item.fileName || 'Photo' : item.fileName || 'File';
  const metaBits = [item.mimeType, formatBytes(item.bytes)].filter(Boolean);
  const busy = phase === 'preparing' || phase === 'uploading' || phase === 'sending';
  const failed = phase === 'failed';
  const progressText =
    statusLabel ||
    (phase === 'preparing'
      ? 'Preparing…'
      : phase === 'uploading'
        ? `Uploading… ${Math.round(uploadProgress)}%`
        : phase === 'sending'
          ? 'Sending…'
          : failed
            ? 'Upload failed'
            : hint);

  return (
    <div
      className={rootClass}
      data-attachment-kind={item.kind}
      data-phase={phase}
      role="group"
      aria-label={previewAriaLabel || `${title} preview`}
    >
      <div className="chat-attachment-preview__frame">
        {item.kind === 'image' ? (
          <img
            src={item.objectUrl}
            alt={title}
            width={item.width || undefined}
            height={item.height || undefined}
          />
        ) : (
          <div className="chat-attachment-preview__file-icon" aria-hidden="true">
            📄
          </div>
        )}
      </div>
      <div className="chat-attachment-preview__meta">
        <p className="chat-attachment-preview__title">{title}</p>
        {metaBits.length > 0 ? (
          <p className="chat-attachment-preview__sub">{metaBits.join(' · ')}</p>
        ) : null}
        <p
          className="chat-attachment-preview__hint"
          role="status"
          aria-live={failed ? 'assertive' : 'polite'}
        >
          {progressText}
        </p>
        {busy ? (
          <div
            className="chat-attachment-preview__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(uploadProgress)}
          >
            <span style={{ width: `${Math.max(8, uploadProgress)}%` }} />
          </div>
        ) : null}
        {failed && onRetry ? (
          <button type="button" className="chat-attachment-preview__retry" onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
      {onClear ? (
        <button
          type="button"
          className="chat-attachment-preview__clear"
          aria-label={removeLabel}
          onClick={onClear}
          disabled={phase === 'sending'}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export default ChatAttachmentPreview;
