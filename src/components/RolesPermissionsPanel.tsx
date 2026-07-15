import { useMemo, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  linkProfilesToRoleDefinitions,
  orderedRoles,
  parseApprovesSubmitterRoles,
} from '../lib/roleResolver';
import { DEFAULT_ROLE_DEFINITIONS } from '../lib/defaultRoleDefinitions';
import { nowIso } from '../lib/utils';
import type { Profile, RoleDefinition, RoleDefinitionSeed } from '../types';

type CapabilityKey = keyof Pick<
  RoleDefinition,
  | 'canEditMaster'
  | 'canManageUsers'
  | 'canReview'
  | 'canPreApproveAccess'
  | 'canAccessAllStores'
  | 'seesAllTemplateItems'
  | 'canExportDashboard'
  | 'canExportReviewStatus'
  | 'canScheduleShifts'
  | 'canDeleteShifts'
  | 'canUseOpsTools'
  | 'canClockIn'
>;

const CAPABILITY_KEYS: CapabilityKey[] = [
  'canEditMaster',
  'canManageUsers',
  'canReview',
  'canPreApproveAccess',
  'canAccessAllStores',
  'seesAllTemplateItems',
  'canExportDashboard',
  'canExportReviewStatus',
  'canScheduleShifts',
  'canDeleteShifts',
  'canUseOpsTools',
  'canClockIn',
];

interface Props {
  currentProfile: Profile;
  allProfiles: Profile[];
  readOnly: boolean;
}

function slugifyKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function staffTemplate(): RoleDefinitionSeed {
  const t = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === 'staff')!;
  return { ...t, key: '', label: '', isSystem: false };
}

export default function RolesPermissionsPanel({
  currentProfile,
  allProfiles,
  readOnly,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const rp = t.users.rolesPermissions;

  const sorted = useMemo(() => orderedRoles(defs), [defs]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [placeBelow, setPlaceBelow] = useState('staff');
  const [saving, setSaving] = useState(false);

  const usageByKey = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allProfiles) {
      counts[p.role] = (counts[p.role] ?? 0) + 1;
    }
    return counts;
  }, [allProfiles]);

  function canEditRole(def: RoleDefinition): boolean {
    if (readOnly) return false;
    if (def.key === 'owner') return false;
    return true;
  }

  function isCapabilityLocked(def: RoleDefinition, key: CapabilityKey): boolean {
    if (def.key === 'owner') {
      return key === 'canManageUsers' || key === 'canEditMaster';
    }
    if (def.isSystem && key === 'canManageUsers') {
      return def.key === 'areaManager' || def.key === 'admin';
    }
    return false;
  }

  async function saveRole(def: RoleDefinition, patch: Partial<RoleDefinition>) {
    setSaving(true);
    try {
      await db.transact(
        db.tx.roleDefinitions[def.id].update({
          ...patch,
          updatedAt: nowIso(),
        }),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCapability(def: RoleDefinition, key: CapabilityKey) {
    if (!canEditRole(def) || isCapabilityLocked(def, key)) return;
    await saveRole(def, { [key]: !def[key] });
  }

  async function toggleApproval(def: RoleDefinition, submitterKey: string) {
    if (!canEditRole(def)) return;
    const current = parseApprovesSubmitterRoles(def.approvesSubmitterRolesJson);
    const next = current.includes(submitterKey)
      ? current.filter((k) => k !== submitterKey)
      : [...current, submitterKey];
    await saveRole(def, { approvesSubmitterRolesJson: JSON.stringify(next) });
  }

  async function addRole() {
    const key = slugifyKey(addKey);
    if (!key) {
      alert(rp.keyRequired);
      return;
    }
    if (sorted.some((d) => d.key === key)) {
      alert(rp.keyExists);
      return;
    }

    const below = sorted.find((d) => d.key === placeBelow);
    const newRank = (below?.rank ?? 5) + 1;

    const bumpTxs = sorted
      .filter((d) => d.rank >= newRank)
      .map((d) =>
        db.tx.roleDefinitions[d.id].update({ rank: d.rank + 1, updatedAt: nowIso() }),
      );

    const template = staffTemplate();
    const defId = id();
    const now = nowIso();

    setSaving(true);
    try {
      await db.transact([
        ...bumpTxs,
        db.tx.roleDefinitions[defId].update({
          ...template,
          key,
          label: addLabel.trim() || key,
          rank: newRank,
          isSystem: false,
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      setShowAdd(false);
      setAddKey('');
      setAddLabel('');
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRole(def: RoleDefinition) {
    if (readOnly || def.isSystem) return;
    const count = usageByKey[def.key] ?? 0;
    if (count > 0) {
      alert(rp.deleteBlockedInUse.replace('{count}', String(count)));
      return;
    }
    if (!confirm(rp.confirmDelete.replace('{label}', def.label))) return;

    setSaving(true);
    try {
      await db.transact(db.tx.roleDefinitions[def.id].delete());
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function relinkProfiles() {
    if (readOnly || currentProfile.role !== 'owner') return;
    const txs = linkProfilesToRoleDefinitions(allProfiles, sorted);
    if (!txs.length) return;
    setSaving(true);
    try {
      await db.transact(txs);
      alert(rp.relinkDone);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const editing = editingId ? sorted.find((d) => d.id === editingId) : null;

  async function saveLabel(def: RoleDefinition) {
    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === def.label) {
      setEditingId(null);
      return;
    }
    await saveRole(def, { label: trimmed });
    setEditingId(null);
  }

  return (
    <div>
      <div className="card">
        <h2 style={{ margin: '0 0 8px' }}>{rp.title}</h2>
        <p className="small" style={{ margin: 0 }}>{rp.subtitle}</p>
        {!readOnly && (
          <div className="capture-actions" style={{ marginTop: 12 }}>
            <button onClick={() => setShowAdd(true)} disabled={saving}>
              {rp.addRole}
            </button>
            <button className="secondary" onClick={relinkProfiles} disabled={saving}>
              {rp.relinkProfiles}
            </button>
          </div>
        )}
        {readOnly && (
          <p className="small" style={{ marginTop: 8 }}>{rp.readOnlyNote}</p>
        )}
      </div>

      <div className="card table-wrap">
        <h3 style={{ marginTop: 0 }}>{rp.hierarchy}</h3>
        <table>
          <thead>
            <tr>
              <th>{rp.rank}</th>
              <th>{rp.key}</th>
              <th>{rp.label}</th>
              <th>{rp.system}</th>
              <th>{rp.inUse}</th>
              {!readOnly && <th>{t.common.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((def) => (
              <tr key={def.id}>
                <td>{def.rank}</td>
                <td><code>{def.key}</code></td>
                <td>
                  {editingId === def.id ? (
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveLabel(def);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => saveLabel(def)}
                      disabled={!canEditRole(def)}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="roles-label"
                      aria-disabled={!canEditRole(def)}
                      onClick={() => {
                        if (!canEditRole(def)) return;
                        setEditingId(def.id);
                        setEditLabel(def.label);
                      }}
                    >
                      {def.label}
                    </button>
                  )}
                </td>
                <td>{def.isSystem ? rp.yes : rp.no}</td>
                <td>{usageByKey[def.key] ?? 0}</td>
                {!readOnly && (
                  <td>
                    {!def.isSystem && (
                      <button
                        className="danger"
                        style={{ fontSize: 12, padding: '4px 8px', minHeight: 28 }}
                        onClick={() => deleteRole(def)}
                        disabled={saving}
                      >
                        {t.common.delete}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3 style={{ marginTop: 0 }}>{rp.capabilities}</h3>
        <table className="roles-matrix-table">
          <thead>
            <tr>
              <th>{rp.capability}</th>
              {sorted.map((def) => (
                <th key={def.id} className="small">{def.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_KEYS.map((key) => (
              <tr key={key}>
                <td className="small">{rp.capabilityLabels[key]}</td>
                {sorted.map((def) => (
                  <td key={`${def.id}-${key}`} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      className="roles-check"
                      checked={!!def[key]}
                      disabled={!canEditRole(def) || isCapabilityLocked(def, key) || saving}
                      onChange={() => toggleCapability(def, key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3 style={{ marginTop: 0 }}>{rp.approvalMatrix}</h3>
        <p className="small">{rp.approvalMatrixHint}</p>
        <table className="roles-matrix-table">
          <thead>
            <tr>
              <th>{rp.submitter}</th>
              {sorted.map((def) => (
                <th key={def.id} className="small">{def.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((submitter) => (
              <tr key={submitter.key}>
                <td className="small">{submitter.label}</td>
                {sorted.map((approver) => {
                  const isOwnerAlways = approver.key === 'owner';
                  const checked =
                    isOwnerAlways ||
                    parseApprovesSubmitterRoles(approver.approvesSubmitterRolesJson).includes(
                      submitter.key,
                    );
                  return (
                    <td key={`${submitter.key}-${approver.key}`} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        className="roles-check"
                        checked={checked}
                        disabled={
                          isOwnerAlways ||
                          !canEditRole(approver) ||
                          submitter.key === approver.key ||
                          saving
                        }
                        onChange={() => toggleApproval(approver, submitter.key)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 300,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 420, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>{rp.addRoleTitle}</h2>
            <label style={{ display: 'block', marginBottom: 12 }}>
              {rp.key}
              <input
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                placeholder="supervisor"
                style={{ marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              {rp.label}
              <input
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Supervisor"
                style={{ marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 16 }}>
              {rp.placeBelow}
              <select
                value={placeBelow}
                onChange={(e) => setPlaceBelow(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {sorted.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="capture-actions">
              <button className="secondary" onClick={() => setShowAdd(false)} disabled={saving}>
                {t.common.cancel}
              </button>
              <button onClick={addRole} disabled={saving}>
                {saving ? t.common.saving : rp.addRole}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
