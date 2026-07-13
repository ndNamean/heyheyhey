import { useLang } from '../i18n';
import type { Store } from '../types';

export interface StorePickerProps {
  stores: Store[];
  selectedStoreIds: string[];
  onChange: (ids: string[]) => void;
}

export default function StorePicker({ stores, selectedStoreIds, onChange }: StorePickerProps) {
  const { t } = useLang();
  const selectedSet = new Set(selectedStoreIds);

  function toggleStore(storeId: string) {
    onChange(
      selectedSet.has(storeId)
        ? selectedStoreIds.filter((id) => id !== storeId)
        : [...selectedStoreIds, storeId],
    );
  }

  function selectAll() {
    onChange(stores.map((s) => s.id));
  }

  function clearAll() {
    onChange([]);
  }

  const countLabel = t.common.selectedCount.replace('{count}', String(selectedStoreIds.length));

  return (
    <div className="store-picker">
      <div className="store-picker-toolbar">
        <div className="store-picker-actions">
          <button
            type="button"
            className="secondary store-picker-action-btn"
            onClick={selectAll}
            disabled={!stores.length || selectedStoreIds.length === stores.length}
          >
            {t.common.selectAll}
          </button>
          <button
            type="button"
            className="secondary store-picker-action-btn"
            onClick={clearAll}
            disabled={!selectedStoreIds.length}
          >
            {t.common.clearAll}
          </button>
        </div>
        <span className="small store-picker-count">{countLabel}</span>
      </div>

      <div className="store-picker-panel">
        {stores.map((s) => (
          <label key={s.id} className="ui-checkbox-label store-picker-row">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={selectedSet.has(s.id)}
              onChange={() => toggleStore(s.id)}
            />
            <span>
              {s.code} — {s.name}
            </span>
          </label>
        ))}
        {!stores.length && <p className="small store-picker-empty">{t.stores.noStores}</p>}
      </div>
    </div>
  );
}
