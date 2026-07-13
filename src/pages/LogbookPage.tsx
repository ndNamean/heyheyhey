import { useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canUseOpsTools } from '../lib/roles';
import { nowIso, todayYmd } from '../lib/utils';
import type { LogbookEntry, Profile, Store } from '../types';

interface Props {
  profile: Profile;
}

export default function LogbookPage({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [storeId, setStoreId] = useState('all');
  const [date, setDate] = useState(todayYmd);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    storeId: '',
    shift: 'AM',
    content: '',
    severity: 'info',
    isAnnouncement: false,
    requiresAck: false,
  });
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({
    logbookEntries: {
      store: {},
      photo: {},
    },
    stores: {},
  });

  const allEntries: LogbookEntry[] = (data?.logbookEntries ?? []) as LogbookEntry[];
  const stores: Store[] = (data?.stores ?? []) as Store[];

  const entries = allEntries
    .filter((e) => {
      if (storeId !== 'all' && e.storeId !== storeId && e.storeId !== '') return false;
      if (date && e.date !== date) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!canUseOpsTools(profile.role, defs)) {
    return <div className="card">{t.logbook.noPermission}</div>;
  }

  async function addEntry() {
    if (!form.content.trim()) return alert(t.logbook.contentRequired);
    setSaving(true);
    try {
      const entryId = id();
      const storeTarget = form.storeId || '';

      const tx = db.tx.logbookEntries[entryId]
        .update({
          storeId: storeTarget,
          authorUserId: profile.userId,
          date: todayYmd(),
          shift: form.shift,
          content: form.content.trim(),
          severity: form.severity,
          isAnnouncement: form.isAnnouncement,
          requiresAck: form.requiresAck,
          ackUserIdsJson: '[]',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });

      const storeTx =
        storeTarget ? db.tx.logbookEntries[entryId].link({ store: storeTarget }) : null;

      await db.transact(storeTx ? [tx, storeTx] : [tx]);
      setForm({ storeId: '', shift: 'AM', content: '', severity: 'info', isAnnouncement: false, requiresAck: false });
      setShowForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge(entry: LogbookEntry) {
    if (!entry.requiresAck) return;
    const current: string[] = JSON.parse(entry.ackUserIdsJson || '[]');
    if (current.includes(profile.userId)) return;
    const updated = [...current, profile.userId];
    await db.transact(
      db.tx.logbookEntries[entry.id].update({
        ackUserIdsJson: JSON.stringify(updated),
        updatedAt: nowIso(),
      }),
    );
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, flex: 1 }}>{t.logbook.title}</h1>
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? t.common.cancel : t.logbook.addEntry}
          </button>
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <label>
            {t.common.store}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="all">{t.common.allStores}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.common.date}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <h2>{t.logbook.newEntry}</h2>
          <div className="grid two">
            <label>
              {t.logbook.storeOptional}
              <select
                value={form.storeId}
                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              >
                <option value="">{t.common.allStores}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.common.shift}
              <select
                value={form.shift}
                onChange={(e) => setForm({ ...form, shift: e.target.value })}
              >
                {['AM', 'PM', 'Night', 'All day'].map((s) => (
                  <option key={s} value={s}>
                    {s === 'All day' ? t.logbook.allDay : s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.common.severity}
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {['info', 'warning', 'critical'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ marginTop: 12, display: 'block' }}>
            {t.common.content}
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={t.logbook.contentPlaceholder}
              style={{ marginTop: 4 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.isAnnouncement}
                onChange={(e) => setForm({ ...form, isAnnouncement: e.target.checked })}
              />
              {t.common.announcement}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.requiresAck}
                onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })}
              />
              {t.logbook.requiresAck}
            </label>
          </div>
          <button style={{ marginTop: 12 }} onClick={addEntry} disabled={saving}>
            {saving ? t.common.saving : t.logbook.saveEntry}
          </button>
        </div>
      )}

      {entries.map((entry) => {
        const ackIds: string[] = JSON.parse(entry.ackUserIdsJson || '[]');
        const meAcked = ackIds.includes(profile.userId);
        const entryStore = (entry as LogbookEntry & { store?: Store }).store;
        return (
          <div className="card" key={entry.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {entry.isAnnouncement && (
                    <span className="badge warn">{t.common.announcement}</span>
                  )}
                  <span
                    className={`badge ${
                      entry.severity === 'critical'
                        ? 'severity-critical'
                        : entry.severity === 'warning'
                          ? 'severity-warning'
                          : 'severity-info'
                    }`}
                  >
                    {entry.severity}
                  </span>
                  <span className="badge">{entry.shift}</span>
                  {entryStore && (
                    <span className="small">{entryStore.code}</span>
                  )}
                </div>
                <p style={{ margin: '8px 0 0' }}>{entry.content}</p>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  {entry.date} · {entry.createdAt?.slice(11, 16)}
                </p>
              </div>
            </div>
            {entry.requiresAck && (
              <div style={{ marginTop: 8 }}>
                {meAcked ? (
                  <span className="badge good">{t.common.acknowledged}</span>
                ) : (
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                    onClick={() => acknowledge(entry)}
                  >
                    {t.common.acknowledge}
                  </button>
                )}
                <span className="small" style={{ marginLeft: 8 }}>
                  {ackIds.length} {ackIds.length !== 1 ? t.logbook.acks : t.logbook.ack}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {!entries.length && (
        <div className="card">
          <p>{t.logbook.noEntries}</p>
        </div>
      )}
    </div>
  );
}
