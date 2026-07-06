import { Suspense, lazy, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
import { canEditMaster } from '../lib/roles';
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

export default function StoresPage({ profile }: Props) {
  const { t } = useLang();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({ stores: {} });
  const stores: Store[] = (data?.stores ?? []) as Store[];

  if (!canEditMaster(profile.role)) {
    return <div className="card">{t.stores.noPermission}</div>;
  }

  function startEdit(store: Store) {
    setEditingId(store.id);
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
  }

  async function saveStore() {
    if (!form.code.trim() || !form.name.trim()) return alert(t.stores.codeNameRequired);
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

      if (editingId) {
        await db.transact(db.tx.stores[editingId].update(payload));
      } else {
        await db.transact(
          db.tx.stores[id()].update({ ...payload, createdAt: nowIso() }),
        );
      }
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
          <input
            value={form.address}
            onChange={(e) => f('address', e.target.value)}
            placeholder={t.stores.addressPlaceholder}
            style={{ marginTop: 4 }}
          />
        </label>

        <div className="map-hint-banner">
          <p className="small">{t.stores.pickLocation}</p>
          <Suspense fallback={<div className="map-loading-placeholder">{t.common.loadingMap}</div>}>
          <MapPicker
            lat={parseFloat(form.lat) || 0}
            lng={parseFloat(form.lng) || 0}
            onSelect={(lat, lng, address) => {
              setForm((prev) => ({
                ...prev,
                lat: lat.toFixed(7),
                lng: lng.toFixed(7),
              address: address || prev.address,
            }));
          }}
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
                <td colSpan={5}>{t.stores.noStores}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
