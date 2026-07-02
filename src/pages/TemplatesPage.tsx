import { useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { canEditMaster, PROOF_TYPES } from '../lib/roles';
import { nowIso } from '../lib/utils';
import type { Profile, Store, Template, TemplateItem } from '../types';

interface Props {
  profile: Profile;
}

interface ItemDraft {
  id: string;
  section: string;
  title: string;
  requirement: string;
  proofType: string;
  required: boolean;
  assignedRole: string;
  approverRoles: string[];
  weight: number;
  failureCategory: string;
}

export default function TemplatesPage({ profile }: Props) {
  const [name, setName] = useState('');
  const [reportType, setReportType] = useState('Daily Hygiene');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({ stores: {}, templates: { items: {}, stores: {} } });
  const stores: Store[] = (data?.stores ?? []) as Store[];
  const templates: Template[] = (data?.templates ?? []) as Template[];

  if (!canEditMaster(profile.role)) {
    return <div className="card">Only owner or area manager can manage templates.</div>;
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        section: 'Kitchen',
        title: '',
        requirement: '',
        proofType: 'photo',
        required: true,
        assignedRole: 'staff',
        approverRoles: ['leader', 'subleader', 'manager'],
        weight: 1,
        failureCategory: 'Hygiene',
      },
    ]);
  }

  function updateItem(itemId: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  }

  function removeItem(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  async function save() {
    if (!name.trim()) return alert('Template name required');
    if (!items.length) return alert('Add at least one checklist item');
    setSaving(true);
    try {
      const templateId = id();

      // Create template
      const templateTx = db.tx.templates[templateId].update({
        name: name.trim(),
        reportType,
        scheduleJson: JSON.stringify({ enabled: false }),
        active: true,
        createdByUserId: profile.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      // Link to stores
      const storeLinkTxs = storeIds.map((sid) =>
        db.tx.templates[templateId].link({ stores: sid }),
      );

      // Create template items
      const itemTxs = items.map((item, i) => {
        const itemId = id();
        return db.tx.templateItems[itemId]
          .update({
            section: item.section,
            title: item.title,
            requirement: item.requirement,
            proofType: item.proofType,
            required: item.required,
            assignedRole: item.assignedRole,
            approverRolesJson: JSON.stringify(item.approverRoles),
            weight: item.weight,
            failureCategory: item.failureCategory,
            sortOrder: i,
          })
          .link({ template: templateId });
      });

      await db.transact([templateTx, ...storeLinkTxs, ...itemTxs]);
      setName('');
      setReportType('Daily Hygiene');
      setStoreIds([]);
      setItems([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(template: Template) {
    if (!confirm(`Deactivate "${template.name}"?`)) return;
    await db.transact(db.tx.templates[template.id].update({ active: false, updatedAt: nowIso() }));
  }

  return (
    <div>
      <div className="card">
        <h1>Templates</h1>
      </div>

      <div className="card">
        <h2>Create template</h2>
        <div className="grid two">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Report type
            <input value={reportType} onChange={(e) => setReportType(e.target.value)} />
          </label>
        </div>

        <label style={{ marginTop: 12, display: 'block' }}>
          Assign to stores
          <select
            multiple
            value={storeIds}
            onChange={(e) =>
              setStoreIds(Array.from(e.target.selectedOptions, (o) => o.value))
            }
            style={{ height: 100, marginTop: 4 }}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>

        <button style={{ marginTop: 12 }} onClick={addItem}>
          + Add checklist item
        </button>

        {items.map((item, i) => (
          <div className="item-card" key={item.id} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Item {i + 1}</h3>
              <button
                className="danger"
                style={{ padding: '4px 10px', minHeight: 32, fontSize: 12 }}
                onClick={() => removeItem(item.id)}
              >
                Remove
              </button>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <input
                placeholder="Section"
                value={item.section}
                onChange={(e) => updateItem(item.id, { section: e.target.value })}
              />
              <input
                placeholder="Title"
                value={item.title}
                onChange={(e) => updateItem(item.id, { title: e.target.value })}
              />
              <textarea
                placeholder="Requirement / description"
                value={item.requirement}
                onChange={(e) => updateItem(item.id, { requirement: e.target.value })}
                style={{ minHeight: 60 }}
              />
              <select
                value={item.proofType}
                onChange={(e) => updateItem(item.id, { proofType: e.target.value })}
              >
                {PROOF_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>
                Assigned role
                <select
                  value={item.assignedRole}
                  onChange={(e) => updateItem(item.id, { assignedRole: e.target.value })}
                >
                  {['staff', 'leader', 'subleader', 'manager', 'areaManager', 'owner'].map(
                    (r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Failure category
                <input
                  value={item.failureCategory}
                  onChange={(e) => updateItem(item.id, { failureCategory: e.target.value })}
                />
              </label>
            </div>
            <label style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={item.required}
                onChange={(e) => updateItem(item.id, { required: e.target.checked })}
              />
              Required
            </label>
          </div>
        ))}

        <button style={{ marginTop: 12 }} onClick={save} disabled={saving}>
          {saving ? 'Creating...' : 'Create template'}
        </button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Stores</th>
              <th>Items</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                </td>
                <td>{t.reportType}</td>
                <td className="small">
                  {(t.stores ?? []).map((s: Store) => s.code).join(', ') || '—'}
                </td>
                <td>{(t.items as TemplateItem[] ?? []).length}</td>
                <td>
                  <span className={t.active ? 'badge good' : 'badge bad'}>
                    {t.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  {t.active && (
                    <button
                      className="danger"
                      style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                      onClick={() => deactivate(t)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!templates.length && (
              <tr>
                <td colSpan={6}>No templates yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
