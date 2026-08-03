import type { Store } from '../../types';

interface Props {
  stores: Store[];
  selectedStoreId: string;
  onChange: (storeId: string) => void;
  disabled?: boolean;
  id?: string;
}

export default function AuthorizedStoreSelector({
  stores,
  selectedStoreId,
  onChange,
  disabled = false,
  id = 'fa-store-selector',
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
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
