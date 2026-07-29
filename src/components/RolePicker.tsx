import { useLang } from '../i18n';

export interface RolePickerProps {
  roles: string[];
  selectedRoles: string[];
  onChange: (roles: string[]) => void;
  compact?: boolean;
}

export default function RolePicker({
  roles,
  selectedRoles,
  onChange,
  compact = false,
}: RolePickerProps) {
  const { t } = useLang();
  const selectedSet = new Set(selectedRoles);

  function toggleRole(role: string) {
    onChange(selectedSet.has(role) ? selectedRoles.filter((value) => value !== role) : [...selectedRoles, role]);
  }

  function selectAll() {
    onChange([...roles]);
  }

  function clearAll() {
    onChange([]);
  }

  const countLabel = t.common.selectedCount.replace('{count}', String(selectedRoles.length));

  return (
    <div className={`store-picker${compact ? ' store-picker-compact' : ''}`}>
      <div className="store-picker-toolbar">
        <div className="store-picker-actions">
          <button
            type="button"
            className="secondary store-picker-action-btn"
            onClick={selectAll}
            disabled={!roles.length || selectedRoles.length === roles.length}
          >
            {t.common.selectAll}
          </button>
          <button
            type="button"
            className="secondary store-picker-action-btn"
            onClick={clearAll}
            disabled={!selectedRoles.length}
          >
            {t.common.clearAll}
          </button>
        </div>
        <span className="small store-picker-count">{countLabel}</span>
      </div>

      <div className="store-picker-panel">
        {roles.map((role) => (
          <label key={role} className="ui-checkbox-label store-picker-row">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={selectedSet.has(role)}
              onChange={() => toggleRole(role)}
            />
            <span>{role}</span>
          </label>
        ))}
        {!roles.length && <p className="small store-picker-empty">{t.users.noOtherUsers}</p>}
      </div>
    </div>
  );
}
