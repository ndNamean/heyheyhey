import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CHAT_FILE_MIME_TYPES,
  CHAT_IMAGE_MIME_TYPES,
} from '../../lib/chatAttachmentPolicy';
import {
  QUICK_MESSAGE_IDS,
  quickMessageI18nKey,
  type QuickMessageId,
} from '../../lib/quickMessages';
import './chatAttachments.css';

export type ComposerAttachMenuLabels = {
  attach: string;
  attachMenuTitle: string;
  camera: string;
  photos: string;
  file: string;
  quickMessage: string;
  closeMenu: string;
  cameraDenied: string;
  chooseFromPhotos: string;
  cancel: string;
  quickMessages: Record<QuickMessageId, string>;
};

export type ComposerAttachMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anchor for desktop popover (+ button). */
  anchorRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  labels: ComposerAttachMenuLabels;
  cameraDenied?: boolean;
  onCameraDeniedDismiss?: () => void;
  onFileChosen: (file: File, source: 'camera' | 'photos' | 'file') => void;
  onQuickMessage: (text: string, id: QuickMessageId) => void;
  /** When camera permission is denied, parent sets cameraDenied; Photos still works. */
  onCameraPermissionDenied?: () => void;
  className?: string;
};

type Surface = 'desktop' | 'mobile';
type MenuView = 'actions' | 'quick';

const IMAGE_ACCEPT = CHAT_IMAGE_MIME_TYPES.join(',');
const FILE_ACCEPT = CHAT_FILE_MIME_TYPES.join(',');

function useSurface(): Surface {
  const [surface, setSurface] = useState<Surface>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'desktop';
    }
    return window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'desktop';
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setSurface(mq.matches ? 'mobile' : 'desktop');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return surface;
}

function placePopover(anchor: HTMLElement | null): CSSProperties {
  const pad = 12;
  const width = Math.min(280, window.innerWidth - pad * 2);
  if (!anchor) {
    return {
      bottom: 96,
      left: Math.max(pad, (window.innerWidth - width) / 2),
      width,
    };
  }
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - pad) {
    left = window.innerWidth - pad - width;
  }
  left = Math.max(pad, left);
  const height = 320;
  const spaceAbove = rect.top - pad;
  if (spaceAbove >= 200) {
    return {
      top: Math.max(pad, rect.top - height - 8),
      left,
      width,
      maxHeight: Math.min(height, spaceAbove),
    };
  }
  return {
    top: Math.min(rect.bottom + 8, window.innerHeight - pad - 160),
    left,
    width,
    maxHeight: Math.min(height, window.innerHeight - rect.bottom - pad * 2),
  };
}

async function probeCameraAccess(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return true;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach (+) menu: Camera / Photos / File / Quick Message.
 * Mobile bottom sheet; desktop anchored popover. GIPHY stays outside this menu.
 * Hidden file inputs stay mounted so camera/photos/file clicks work after close.
 */
export function ComposerAttachMenu({
  open,
  onOpenChange,
  anchorRef,
  disabled,
  labels,
  cameraDenied = false,
  onCameraDeniedDismiss,
  onFileChosen,
  onQuickMessage,
  onCameraPermissionDenied,
  className,
}: ComposerAttachMenuProps) {
  const surface = useSurface();
  const titleId = useId();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<MenuView>('actions');
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) setView('actions');
  }, [open]);

  useLayoutEffect(() => {
    if (!open || surface !== 'desktop') return;
    const sync = () => setPopoverStyle(placePopover(anchorRef.current));
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [open, surface, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    restoreFocusRef.current =
      (active instanceof HTMLElement ? active : null) ||
      (anchorRef.current instanceof HTMLElement ? anchorRef.current : null);

    const focusTimer = window.setTimeout(() => {
      const preferred = cameraDenied
        ? panelRef.current?.querySelector<HTMLElement>(
            '.composer-attach-menu__denied button',
          )
        : panelRef.current?.querySelector<HTMLElement>(
            '.composer-attach-menu__item:not([disabled])',
          );
      preferred?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      const restore =
        (anchorRef.current instanceof HTMLElement && document.contains(anchorRef.current)
          ? anchorRef.current
          : null) || restoreFocusRef.current;
      restoreFocusRef.current = null;
      requestAnimationFrame(() => {
        restore?.focus?.();
      });
    };
  }, [open, cameraDenied, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (view === 'quick') {
          setView('actions');
          window.setTimeout(() => {
            panelRef.current
              ?.querySelector<HTMLElement>('.composer-attach-menu__item:not([disabled])')
              ?.focus();
          }, 0);
          return;
        }
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, view]);

  function close() {
    onOpenChange(false);
    setView('actions');
  }

  function handleInputChange(
    source: 'camera' | 'photos' | 'file',
    files: FileList | null,
  ) {
    const file = files?.[0];
    if (file) onFileChosen(file, source);
  }

  async function onCameraClick() {
    const ok = await probeCameraAccess();
    if (!ok) {
      onCameraPermissionDenied?.();
      return;
    }
    close();
    // Defer so the sheet unmounts before the native picker opens.
    window.setTimeout(() => cameraInputRef.current?.click(), 0);
  }

  function onPhotosClick() {
    onCameraDeniedDismiss?.();
    close();
    window.setTimeout(() => photosInputRef.current?.click(), 0);
  }

  function onFileClick() {
    close();
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }

  const inputs = (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        aria-label={labels.camera}
        onChange={(e) => {
          handleInputChange('camera', e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={photosInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        aria-label={labels.photos}
        onChange={(e) => {
          handleInputChange('photos', e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        aria-label={labels.file}
        onChange={(e) => {
          handleInputChange('file', e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );

  if (!open) {
    return inputs;
  }

  const rootClass = ['composer-attach-menu', className].filter(Boolean).join(' ');

  const menu = (
    <div className={rootClass} data-surface={surface}>
      <button
        type="button"
        className="composer-attach-menu__backdrop"
        aria-label={labels.closeMenu}
        onClick={close}
      />
      <div
        ref={panelRef}
        className={
          surface === 'mobile'
            ? 'composer-attach-menu__panel composer-attach-menu__panel--sheet'
            : 'composer-attach-menu__panel composer-attach-menu__panel--popover'
        }
        style={surface === 'desktop' ? popoverStyle : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {surface === 'mobile' ? (
          <div className="composer-attach-menu__handle" aria-hidden="true" />
        ) : null}
        <p id={titleId} className="composer-attach-menu__title">
          {view === 'quick' ? labels.quickMessage : labels.attachMenuTitle}
        </p>

        {cameraDenied ? (
          <div className="composer-attach-menu__denied" role="status" aria-live="polite">
            <p>{labels.cameraDenied}</p>
            <button
              type="button"
              className="composer-attach-menu__item"
              onClick={onPhotosClick}
            >
              {labels.chooseFromPhotos}
            </button>
          </div>
        ) : null}

        {view === 'actions' ? (
          <ul className="composer-attach-menu__list" role="menu" aria-labelledby={titleId}>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu__item"
                disabled={disabled}
                onClick={() => void onCameraClick()}
              >
                {labels.camera}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu__item"
                disabled={disabled}
                onClick={onPhotosClick}
              >
                {labels.photos}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu__item"
                disabled={disabled}
                onClick={onFileClick}
              >
                {labels.file}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu__item"
                disabled={disabled}
                onClick={() => setView('quick')}
              >
                {labels.quickMessage}
              </button>
            </li>
          </ul>
        ) : (
          <ul className="composer-attach-menu__list" role="menu" aria-label={labels.quickMessage}>
            {QUICK_MESSAGE_IDS.map((id) => (
              <li key={id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="composer-attach-menu__item"
                  disabled={disabled}
                  onClick={() => {
                    onQuickMessage(labels.quickMessages[id], id);
                    close();
                  }}
                >
                  {labels.quickMessages[id]}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="composer-attach-menu__cancel" onClick={close}>
          {labels.cancel}
        </button>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return inputs;
  return (
    <>
      {inputs}
      {createPortal(menu, document.body)}
    </>
  );
}

/** Build quick-message label map from storeChat i18n object. */
export function buildQuickMessageLabels(
  sc: Record<string, string>,
): Record<QuickMessageId, string> {
  const out = {} as Record<QuickMessageId, string>;
  for (const id of QUICK_MESSAGE_IDS) {
    const key = quickMessageI18nKey(id);
    out[id] = sc[key] || id;
  }
  return out;
}

export default ComposerAttachMenu;
