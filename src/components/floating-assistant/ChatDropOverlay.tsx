import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import './chatAttachments.css';

export type ChatDropOverlayProps = {
  enabled: boolean;
  /** Drop hint copy. */
  label: string;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
};

function isFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/**
 * Drag-over overlay for the chat message body (not panel chrome).
 * Stages dropped files via parent `onFiles` — same pipeline as file picker.
 */
export function ChatDropOverlay({
  enabled,
  label,
  onFiles,
  children,
  className,
}: ChatDropOverlayProps) {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setActive(false);
  }, []);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  function onDragEnter(e: DragEvent) {
    if (!enabled || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current += 1;
    setActive(true);
  }

  function onDragOver(e: DragEvent) {
    if (!enabled || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: DragEvent) {
    if (!enabled || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setActive(false);
  }

  function onDrop(e: DragEvent) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    reset();
    const list = e.dataTransfer?.files;
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  const rootClass = ['chat-drop-target', className].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      data-drop-active={active ? 'true' : 'false'}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {active ? (
        <div className="chat-drop-overlay" role="status" aria-live="polite">
          <p className="chat-drop-overlay__label">{label}</p>
        </div>
      ) : null}
    </div>
  );
}

export default ChatDropOverlay;
