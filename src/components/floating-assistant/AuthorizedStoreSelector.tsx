import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Store } from '../../types';
import ProfileAvatar from '../profileAvatar/ProfileAvatar';
import type { UnreadSenderSummary } from './useUnreadStoreChat';

const MAX_VISIBLE_SENDERS = 3;

interface Props {
  stores: Store[];
  selectedStoreId: string;
  onChange: (storeId: string) => void;
  disabled?: boolean;
  id?: string;
  unreadByStore?: Record<string, number>;
  unreadSendersByStore?: Record<string, UnreadSenderSummary[]>;
}

function formatUnreadDisplay(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function storeBaseLabel(store: Store): string {
  return `${store.code} — ${store.name}`;
}

function senderDisplayName(sender: UnreadSenderSummary): string {
  return sender.profile.displayName?.trim() || sender.profile.email?.trim() || 'Unknown';
}

function buildAriaLabel(
  store: Store,
  unread: number,
  senders: UnreadSenderSummary[],
): string {
  const base = storeBaseLabel(store);
  if (unread <= 0) return base;
  const msgPart = `${unread} unread ${unread === 1 ? 'message' : 'messages'}`;
  if (!senders.length) return `${base}, ${msgPart}`;
  const breakdown = senders
    .map((s) => `${senderDisplayName(s)} ${formatUnreadDisplay(s.count)}`)
    .join(', ');
  return `${base}, ${msgPart}: ${breakdown}`;
}

function UnreadSenderAvatarStack({ senders }: { senders: UnreadSenderSummary[] }) {
  if (!senders.length) return null;
  const visible = senders.slice(0, MAX_VISIBLE_SENDERS);
  const overflow = senders.length - visible.length;

  return (
    <span className="fa-store-unread-avatars" aria-hidden="true">
      {visible.map((sender) => (
        <span key={sender.userId} className="fa-store-sender-avatar">
          <ProfileAvatar profile={sender.profile} size={18} />
          <span className="fa-store-sender-count">{formatUnreadDisplay(sender.count)}</span>
        </span>
      ))}
      {overflow > 0 ? <span className="fa-store-sender-overflow">+{overflow}</span> : null}
    </span>
  );
}

export default function AuthorizedStoreSelector({
  stores,
  selectedStoreId,
  onChange,
  disabled = false,
  id = 'fa-store-selector',
  unreadByStore = {},
  unreadSendersByStore = {},
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const isLocked = disabled || stores.length <= 1;

  const selectedStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null,
    [stores, selectedStoreId],
  );

  const selectedUnread = selectedStore ? (unreadByStore[selectedStore.id] ?? 0) : 0;
  const selectedSenders = selectedStore
    ? (unreadSendersByStore[selectedStore.id] ?? [])
    : [];

  const close = useCallback(() => setOpen(false), []);

  const selectStore = useCallback(
    (storeId: string) => {
      onChange(storeId);
      setOpen(false);
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      stores.findIndex((s) => s.id === selectedStoreId),
    );
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, stores, selectedStoreId]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  if (!stores.length) {
    return (
      <p className="fa-store-empty small" id={id}>
        No authorized active stores
      </p>
    );
  }

  function moveActive(delta: number) {
    setActiveIndex((prev) => {
      const next = (prev + delta + stores.length) % stores.length;
      return next;
    });
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (isLocked) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        moveActive(e.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        {
          const store = stores[activeIndex];
          if (store) selectStore(store.id);
        }
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActiveIndex(stores.length - 1);
        }
        break;
      default:
        break;
    }
  }

  const triggerAria =
    selectedStore != null
      ? buildAriaLabel(selectedStore, selectedUnread, selectedSenders)
      : 'Select store for assistant and chat';

  return (
    <div className="fa-store-selector" ref={rootRef}>
      <span className="fa-store-selector-label" id={`${id}-label`}>
        Store
      </span>
      <button
        type="button"
        id={id}
        className={`fa-store-selector-trigger${selectedUnread > 0 ? ' has-unread' : ''}`}
        disabled={isLocked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && stores[activeIndex] ? `${id}-option-${stores[activeIndex].id}` : undefined
        }
        aria-labelledby={`${id}-label`}
        aria-label={triggerAria}
        onClick={() => {
          if (isLocked) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="fa-store-selector-trigger-text">
          {selectedStore ? storeBaseLabel(selectedStore) : 'Select store'}
        </span>
        {selectedUnread > 0 ? <UnreadSenderAvatarStack senders={selectedSenders} /> : null}
        {!isLocked ? (
          <span className="fa-store-selector-chevron" aria-hidden="true">
            ▾
          </span>
        ) : null}
      </button>

      {open && !isLocked ? (
        <ul
          id={listboxId}
          className="fa-store-selector-list"
          role="listbox"
          aria-labelledby={`${id}-label`}
          tabIndex={-1}
        >
          {stores.map((store, index) => {
            const unread = unreadByStore[store.id] ?? 0;
            const senders = unreadSendersByStore[store.id] ?? [];
            const selected = store.id === selectedStoreId;
            const active = index === activeIndex;
            const optionLabel = buildAriaLabel(store, unread, senders);

            return (
              <li
                key={store.id}
                id={`${id}-option-${store.id}`}
                role="option"
                aria-selected={selected}
                aria-label={optionLabel}
                className={[
                  'fa-store-option',
                  unread > 0 ? 'has-unread' : '',
                  selected ? 'is-selected' : '',
                  active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectStore(store.id)}
              >
                <span className="fa-store-option-text">{storeBaseLabel(store)}</span>
                {unread > 0 ? <UnreadSenderAvatarStack senders={senders} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
