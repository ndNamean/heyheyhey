import { useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import LanguageSelector from '../components/LanguageSelector';
import { nowIso } from '../lib/utils';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function ProfilePage({ profile }: Props) {
  const { t } = useLang();
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
      alert(e instanceof Error ? e.message : t.profile.updateFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h1>{t.profile.title}</h1>

        {editing ? (
          <>
            <label style={{ display: 'block', marginBottom: 12 }}>
              {t.profile.displayName}
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{ marginTop: 4 }}
              />
            </label>
            <div className="capture-actions">
              <button className="secondary" onClick={() => { setEditing(false); setDisplayName(profile.displayName); }} disabled={saving}>
                {t.common.cancel}
              </button>
              <button onClick={save} disabled={saving || !displayName.trim()}>
                {saving ? t.common.saving : t.common.save}
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
              {t.profile.role}: <span className="badge">{profile.role}</span>
            </p>
            <p className="small">
              {t.profile.storesLabel}: {storeNames || t.profile.noneAssigned}
            </p>
            <button
              className="secondary"
              style={{ marginTop: 12, fontSize: 13, padding: '8px 14px', minHeight: 38 }}
              onClick={() => setEditing(true)}
            >
              {t.profile.editDisplayName}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.profile.language}</h2>
        <p className="small">{t.profile.languageHint}</p>
        <LanguageSelector />
      </div>

      <div className="card">
        <button className="danger" onClick={() => db.auth.signOut()}>
          {t.profile.signOut}
        </button>
      </div>
    </div>
  );
}
