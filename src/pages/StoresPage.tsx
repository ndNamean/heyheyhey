import { Suspense, lazy, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({ stores: {} });
  const stores: Store[] = (data?.stores ?? []) as Store[];

  if (!canEditMaster(profile.role)) {
    return <div className="card">Only owner or area manager can manage stores.</div>;
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
    if (!form.code.trim() || !form.name.trim()) return alert('Code and name are required');
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
      alert(e instanceof Error ? e.message : 'Failed to save store');
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
        <h1>Stores</h1>
      </div>

      <div className="card">
        <h2>{editingId ? 'Edit store' : 'Add store'}</h2>

        <div className="grid two" style={{ marginBottom: 12 }}>
          <label>
            Store code
            <input
              value={form.code}
              onChange={(e) => f('code', e.target.value)}
              placeholder="e.g. VO"
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            Store name
            <input
              value={form.name}
              onChange={(e) => f('name', e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            Area / region
            <input
              value={form.area}
              onChange={(e) => f('area', e.target.value)}
              placeholder="e.g. HCM"
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            Geofence radius (metres)
            <input
              type="number"
              value={form.geofenceRadiusM}
              onChange={(e) => f('geofenceRadiusM', e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>

        {/* Address — auto-filled from map but editable */}
        <label style={{ display: 'block', marginBottom: 12 }}>
          Address
          <input
            value={form.address}
            onChange={(e) => f('address', e.target.value)}
            placeholder="Will auto-fill when you pick a location on the map"
            style={{ marginTop: 4 }}
          />
        </label>

        {/* Map picker */}
        <div className="map-hint-banner">
          <p className="small">Pick location on map</p>
          <Suspense fallback={<div className="map-loading-placeholder">Loading map…</div>}>
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

        {/* Lat / Lng read-only display (auto-filled from map) */}
        <div className="grid two" style={{ marginBottom: 12 }}>
          <label>
            Latitude
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={(e) => f('lat', e.target.value)}
              placeholder="Auto-filled from map"
              className={form.lat ? 'input-filled' : 'input-readonly-muted'}
              style={{ marginTop: 4 }}
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              value={form.lng}
              onChange={(e) => f('lng', e.target.value)}
              placeholder="Auto-filled from map"
              className={form.lng ? 'input-filled' : 'input-readonly-muted'}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>

        <div className="capture-actions">
          {editingId && (
            <button className="secondary" onClick={cancelEdit}>
              Cancel
            </button>
          )}
          <button onClick={saveStore} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Update store' : 'Create store'}
          </button>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Area</th>
              <th>Coords</th>
              <th>Active</th>
              <th>Actions</th>
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
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32, marginRight: 6 }}
                    onClick={() => startEdit(s)}
                  >
                    Edit
                  </button>
                  {s.active && (
                    <button
                      className="danger"
                      style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                      onClick={() => deactivate(s)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!stores.length && (
              <tr>
                <td colSpan={5}>No stores yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
