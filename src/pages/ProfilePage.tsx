import { useState } from 'react';
import { db } from '../db';
import { nowIso } from '../lib/utils';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function ProfilePage({ profile }: Props) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [saving, setSaving] = useState(false);

  const storeNames = (profile.stores ?? []).map((s) => `${s.code} — ${s.name}`).join(', ');

  async function save() {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await db.transact(
        db.tx.profiles[profile.id].update({
          displayName: displayName.trim(),
          updatedAt: nowIso(),
        }),
      );
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h1>Profile</h1>

        {editing ? (
          <>
            <label style={{ display: 'block', marginBottom: 12 }}>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{ marginTop: 4 }}
              />
            </label>
            <div className="capture-actions">
              <button className="secondary" onClick={() => { setEditing(false); setDisplayName(profile.displayName); }} disabled={saving}>
                Cancel
              </button>
              <button onClick={save} disabled={saving || !displayName.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <strong>{profile.displayName || profile.email}</strong>
            </p>
            <p className="small">{profile.email}</p>
            <p>
              Role: <span className="badge">{profile.role}</span>
            </p>
            <p className="small">Stores: {storeNames || 'None assigned'}</p>
            <button
              className="secondary"
              style={{ marginTop: 12, fontSize: 13, padding: '8px 14px', minHeight: 38 }}
              onClick={() => setEditing(true)}
            >
              Edit display name
            </button>
          </>
        )}
      </div>

      <div className="card">
        <button className="danger" onClick={() => db.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
