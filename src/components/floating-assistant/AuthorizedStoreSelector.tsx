import type { Store } from '../../types';

interface Props {
  stores: Store[];
  selectedStoreId: string;
  onChange: (storeId: string) => void;
  disabled?: boolean;
  id?: string;
  unreadByStore?: Record<string, number>;
}

function formatUnreadDisplay(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export default function AuthorizedStoreSelector({
  stores,
  selectedStoreId,
  onChange,
  disabled = false,
  id = 'fa-store-selector',
  unreadByStore = {},
}: Props) {
  if (!stores.length) {
    return (
      <p className="fa-store-empty small" id={id}>
        No authorized active stores
      </p>
    );
  }

  return (
    <label className="fa-store-selector">
      <span className="fa-store-selector-label">Store</span>
      <select
        id={id}
        value={selectedStoreId}
        disabled={disabled || stores.length === 1}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select store for assistant and chat"
      >
        {stores.map((s) => {
          const unread = unreadByStore[s.id] ?? 0;
          const baseLabel = `${s.code} — ${s.name}`;
          const label =
            unread > 0 ? `${baseLabel} (${formatUnreadDisplay(unread)})` : baseLabel;
          const ariaLabel =
            unread > 0
              ? `${baseLabel}, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
              : baseLabel;
          return (
            <option key={s.id} value={s.id} aria-label={ariaLabel}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
