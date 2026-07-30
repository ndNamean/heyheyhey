import { Suspense, lazy, useState } from 'react';
import { id } from '@instantdb/react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canEditMaster } from '../lib/roles';
import type { NominatimResult } from '../lib/nominatim';
import {
  findDuplicateActiveIpAssignment,
  isValidExactPublicIp,
  normalizePublicIp,
  type WifiIpRowLike,
} from '../lib/storeWifiIp';
import { nowIso } from '../lib/utils';
import type { Profile, Store } from '../types';

const MapPicker = lazy(() => import('../components/MapPicker'));

interface Props {
  profile: Profile;
}

const EMPTY_FORM = {
  code: '',
  name: '',
  address: '',
  area: '',
  lat: '',
  lng: '',
  geofenceRadiusM: '200',
};

interface WifiDraftRow {
  /** Stable local key for React lists (not necessarily a DB id). */
  key: string;
  id?: string;
  label: string;
  publicIp: string;
  active: boolean;
  _remove?: boolean;
}

function newDraftKey() {
  return `draft-${id()}`;
}

function emptyWifiRow(): WifiDraftRow {
  return { key: newDraftKey(), label: '', publicIp: '', active: true };
}

function rowsFromStore(store: Store): WifiDraftRow[] {
  return (store.wifiIps ?? []).map((w) => ({
    key: w.id,
    id: w.id,
    label: w.label ?? '',
    publicIp: w.publicIp ?? '',
    active: !!w.active,
  }));
}

function countActiveWifiIps(store: Store): number {
  return (store.wifiIps ?? []).filter((w) => w.active).length;
}

async function fetchClientPublicIp(): Promise<string> {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');

  const resp = await fetch('/api/wifi-notify/client-ip', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`);
    }
  }
  if (!resp.ok) {
    throw new Error(String(data.error || `Request failed (${resp.status})`));
  }
  const publicIp = normalizePublicIp(String(data.publicIp ?? ''));
  if (!publicIp) throw new Error('No public IP returned');
  return publicIp;
}

function otherStoreWifiIps(stores: Store[], excludeStoreId: string | null): WifiIpRowLike[] {
  const out: WifiIpRowLike[] = [];
  for (const s of stores) {
    if (excludeStoreId && s.id === excludeStoreId) continue;
    for (const w of s.wifiIps ?? []) {
      out.push({
        id: w.id,
        storeId: s.id,
        publicIp: w.publicIp,
        active: !!w.active,
      });
    }
  }
  return out;
}

export default function StoresPage({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wifiBusy, setWifiBusy] = useState(false);
  const [wifiRows, setWifiRows] = useState<WifiDraftRow[]>([emptyWifiRow()]);
  const [mapFlyTarget, setMapFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  const { data } = db.useQuery({ stores: { wifiIps: {} } });
  const stores: Store[] = (data?.stores ?? []) as Store[];

  if (!canEditMaster(profile.role, defs)) {
    return <div className="card">{t.stores.noPermission}</div>;
  }

  function startEdit(store: Store) {
    setEditingId(store.id);
    setMapFlyTarget(null);
    const existing = rowsFromStore(store);
    setWifiRows(existing.length > 0 ? existing : [emptyWifiRow()]);
    setForm({
      code: store.code,
      name: store.name,
      address: store.address,
      area: store.area,
      lat: String(store.lat ?? ''),
      lng: String(store.lng ?? ''),
      geofenceRadiusM: String(store.geofenceRadiusM ?? 200),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setWifiRows([emptyWifiRow()]);
    setMapFlyTarget(null);
  }

  function applyLocation(lat: number, lng: number, address: string, fly = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setForm((prev) => ({
      ...prev,
      lat: lat.toFixed(7),
      lng: lng.toFixed(7),
      address: address || prev.address,
    }));
    if (fly) setMapFlyTarget({ lat, lng });
  }

  function handleAddressSuggestion(result: NominatimResult) {
    const lat = Number.parseFloat(result.lat);
    const lng = Number.parseFloat(result.lon);
    applyLocation(lat, lng, result.display_name, true);
  }

  function updateWifiRow(key: string, patch: Partial<WifiDraftRow>) {
    setWifiRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addWifiRow() {
    setWifiRows((prev) => [...prev, emptyWifiRow()]);
  }

  function removeWifiRow(key: string) {
    if (!confirm(t.stores.wifiIpRemoveConfirm)) return;
    setWifiRows((prev) => {
      const next = prev
        .map((r) => (r.key === key ? (r.id ? { ...r, _remove: true, active: false } : null) : r))
        .filter((r): r is WifiDraftRow => r != null);
      return next.some((r) => !r._remove) ? next : [...next, emptyWifiRow()];
    });
  }

  async function detectCurrentIp() {
    setWifiBusy(true);
    try {
      const publicIp = await fetchClientPublicIp();
      const confirmed = confirm(
        t.stores.wifiIpDetectConfirm.replace('{ip}', publicIp),
      );
      if (!confirmed) return;

      const alreadyInDraft = wifiRows.some(
        (r) =>
          !r._remove &&
          normalizePublicIp(r.publicIp) === publicIp,
      );
      if (alreadyInDraft) {
        alert(t.stores.wifiIpDetectDuplicate);
        return;
      }

      setWifiRows((prev) => [
        ...prev,
        { key: newDraftKey(), label: '', publicIp, active: true },
      ]);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.stores.wifiIpDetectFailed);
    } finally {
      setWifiBusy(false);
    }
  }

  async function testCurrentNetwork() {
    setWifiBusy(true);
    try {
      const publicIp = await fetchClientPublicIp();
      const candidates = wifiRows
        .filter((r) => !r._remove && r.active)
        .map((r) => normalizePublicIp(r.publicIp))
        .filter((ip): ip is string => !!ip);

      // Prefer draft active IPs; fall back to saved active IPs when draft is empty (create form).
      let matchPool = candidates;
      if (!matchPool.length && editingId) {
        const store = stores.find((s) => s.id === editingId);
        matchPool = (store?.wifiIps ?? [])
          .filter((w) => w.active)
          .map((w) => normalizePublicIp(w.publicIp))
          .filter((ip): ip is string => !!ip);
      }

      const matched = matchPool.includes(publicIp);
      alert(
        (matched ? t.stores.wifiIpTestMatch : t.stores.wifiIpTestNoMatch).replace(
          '{ip}',
          publicIp,
        ),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : t.stores.wifiIpTestFailed);
    } finally {
      setWifiBusy(false);
    }
  }

  async function saveStore() {
    if (!form.code.trim() || !form.name.trim()) return alert(t.stores.codeNameRequired);
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return alert(t.stores.coordsRequired);
    }

    const keepRows = wifiRows.filter((r) => !r._remove);
    const rowsToSave = keepRows.filter((r) => normalizePublicIp(r.publicIp));
    // Reject keep-rows that have whitespace-only invalid content after optional blank strip:
    // blank IP rows are dropped; non-blank invalid IPs fail.
    for (const row of keepRows) {
      const raw = row.publicIp.trim();
      if (!raw) continue;
      const normalized = normalizePublicIp(raw);
      if (!normalized || !isValidExactPublicIp(normalized)) {
        return alert(t.stores.wifiIpInvalid.replace('{ip}', raw));
      }
    }

    const otherIps = otherStoreWifiIps(stores, editingId);
    const draftActiveAsRows: WifiIpRowLike[] = rowsToSave
      .filter((r) => r.active)
      .map((r) => ({
        id: r.id ?? r.key,
        storeId: editingId ?? '__new__',
        publicIp: normalizePublicIp(r.publicIp)!,
        active: true,
      }));

    for (const row of draftActiveAsRows) {
      const dupOther = findDuplicateActiveIpAssignment(row.publicIp, otherIps);
      if (dupOther) {
        return alert(t.stores.wifiIpDuplicate.replace('{ip}', row.publicIp));
      }
      const dupDraft = findDuplicateActiveIpAssignment(
        row.publicIp,
        draftActiveAsRows,
        row.id,
      );
      if (dupDraft) {
        return alert(t.stores.wifiIpDuplicateDraft.replace('{ip}', row.publicIp));
      }
    }

    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        address: form.address.trim(),
        area: form.area.trim(),
        lat: parseFloat(form.lat) || 0,
        lng: parseFloat(form.lng) || 0,
        geofenceRadiusM: parseInt(form.geofenceRadiusM) || 200,
        active: true,
        updatedAt: nowIso(),
      };

      const storeId = editingId ?? id();
      const txs = [];

      if (editingId) {
        txs.push(db.tx.stores[editingId].update(payload));
      } else {
        txs.push(db.tx.stores[storeId].update({ ...payload, createdAt: nowIso() }));
      }

      const ts = nowIso();
      for (const row of wifiRows) {
        if (row._remove && row.id) {
          txs.push(
            db.tx.storeWifiIps[row.id].update({
              active: false,
              updatedAt: ts,
            }),
          );
          continue;
        }
        if (row._remove) continue;

        const normalized = normalizePublicIp(row.publicIp);
        if (!normalized) continue;

        const wifiPayload = {
          storeId,
          label: row.label.trim(),
          publicIp: normalized,
          active: !!row.active,
          updatedAt: ts,
        };

        if (row.id) {
          txs.push(db.tx.storeWifiIps[row.id].update(wifiPayload));
        } else {
          const wifiId = id();
          txs.push(
            db.tx.storeWifiIps[wifiId]
              .update({ ...wifiPayload, createdAt: ts })
              .link({ store: storeId }),
          );
        }
      }

      await db.transact(txs);
      cancelEdit();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.stores.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(store: Store) {
    if (!confirm(`Deactivate ${store.name}?`)) return;
    await db.transact(db.tx.stores[store.id].update({ active: false, updatedAt: nowIso() }));
  }

  const f = (k: keyof typeof form, v: string) => setForm((prev) => ({ ...prev, [k]: v }));
  const visibleWifiRows = wifiRows.filter((r) => !r._remove);

  return (
    <div>
      <div className="card">
        <h1>{t.stores.title}</h1>
      </div>

      <div className="card">
        <h2>{editingId ? t.stores.edit : t.stores.add}</h2>

        <div className="grid two" style={{ marginBottom: 12 }}>
          <label>
            {t.stores.storeCode}
            <input
              value={form.code}
              onChange={(e) => f('code', e.target.value)}
              placeholder="e.g. VO"
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            {t.stores.storeName}
            <input
              value={form.name}
              onChange={(e) => f('name', e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            {t.stores.areaRegion}
            <input
              value={form.area}
              onChange={(e) => f('area', e.target.value)}
              placeholder="e.g. HCM"
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            {t.stores.geofenceRadius}
            <input
              type="number"
              value={form.geofenceRadiusM}
              onChange={(e) => f('geofenceRadiusM', e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          {t.common.address}
          <AddressAutocomplete
            value={form.address}
            onChange={(v) => f('address', v)}
            onSelect={handleAddressSuggestion}
            placeholder={t.stores.addressPlaceholder}
          />
        </label>

        <div className="map-hint-banner">
          <p className="small">{t.stores.pickLocation}</p>
          <Suspense fallback={<div className="map-loading-placeholder">{t.common.loadingMap}</div>}>
          <MapPicker
            lat={parseFloat(form.lat) || 0}
            lng={parseFloat(form.lng) || 0}
            flyTarget={mapFlyTarget}
            onSelect={(lat, lng, address) => applyLocation(lat, lng, address, false)}
          />
          </Suspense>
        </div>

        <div className="grid two" style={{ marginBottom: 12 }}>
          <label>
            {t.stores.latitude}
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={(e) => f('lat', e.target.value)}
              placeholder={t.stores.autoFromMap}
              className={form.lat ? 'input-filled' : 'input-readonly-muted'}
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            {t.stores.longitude}
            <input
              type="number"
              step="any"
              value={form.lng}
              onChange={(e) => f('lng', e.target.value)}
              placeholder={t.stores.autoFromMap}
              className={form.lng ? 'input-filled' : 'input-readonly-muted'}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t.stores.wifiIpsTitle}</h3>
          <p className="small" style={{ marginTop: 0, marginBottom: 10 }}>
            {t.stores.wifiIpsHelper}
          </p>

          {visibleWifiRows.map((row) => (
            <div key={row.key} style={{ marginBottom: 10 }}>
              <label>
                {t.stores.wifiIpAddress}
                <input
                  value={row.publicIp}
                  onChange={(e) => updateWifiRow(row.key, { publicIp: e.target.value })}
                  placeholder={t.stores.wifiIpPlaceholder}
                  style={{ marginTop: 4 }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div
                className="grid two"
                style={{ marginTop: 8, alignItems: 'end', gap: 8 }}
              >
                <label>
                  {t.stores.wifiIpLabel}
                  <input
                    value={row.label}
                    onChange={(e) => updateWifiRow(row.key, { label: e.target.value })}
                    placeholder={t.stores.wifiIpLabelPlaceholder}
                    style={{ marginTop: 4 }}
                  />
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <label className="ui-checkbox-label">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={row.active}
                      onChange={(e) => updateWifiRow(row.key, { active: e.target.checked })}
                    />
                    {t.stores.wifiIpActive}
                  </label>
                  <button
                    type="button"
                    className="danger"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                    onClick={() => removeWifiRow(row.key)}
                  >
                    {t.stores.wifiIpRemove}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="capture-actions" style={{ marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="secondary" onClick={addWifiRow} disabled={wifiBusy}>
              {t.stores.wifiIpAddAnother}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={detectCurrentIp}
              disabled={wifiBusy || saving}
            >
              {t.stores.wifiIpDetect}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={testCurrentNetwork}
              disabled={wifiBusy || saving}
            >
              {t.stores.wifiIpTest}
            </button>
          </div>
        </div>

        <div className="capture-actions">
          {editingId && (
            <button className="secondary" onClick={cancelEdit}>
              {t.common.cancel}
            </button>
          )}
          <button onClick={saveStore} disabled={saving}>
            {saving ? t.common.saving : editingId ? t.stores.updateStore : t.stores.createStore}
          </button>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t.common.store}</th>
              <th>{t.common.area}</th>
              <th>{t.stores.coords}</th>
              <th>{t.stores.wifiListColumn}</th>
              <th>{t.stores.active}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong>
                  <br />
                  {s.name}
                  <div className="small">{s.address}</div>
                </td>
                <td>{s.area}</td>
                <td className="small">
                  {s.lat ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : '—'}
                </td>
                <td className="small">
                  {t.stores.wifiActiveCount.replace('{n}', String(countActiveWifiIps(s)))}
                </td>
                <td>
                  <span className={s.active ? 'badge good' : 'badge bad'}>
                    {s.active ? t.common.active : t.common.inactive}
                  </span>
                </td>
                <td>
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32, marginRight: 6 }}
                    onClick={() => startEdit(s)}
                  >
                    {t.common.edit}
                  </button>
                  {s.active && (
                    <button
                      className="danger"
                      style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                      onClick={() => deactivate(s)}
                    >
                      {t.stores.deactivate}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!stores.length && (
              <tr>
                <td colSpan={6}>{t.stores.noStores}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
