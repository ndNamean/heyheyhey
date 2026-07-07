import { useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
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

const DEFAULT_APPROVER_ROLES = ['leader', 'subleader', 'manager'];

function parseApproverRoles(json: string | undefined): string[] {
  if (!json?.trim()) return [...DEFAULT_APPROVER_ROLES];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_APPROVER_ROLES];
  } catch {
    return [...DEFAULT_APPROVER_ROLES];
  }
}

function templateItemToDraft(item: TemplateItem): ItemDraft {
  return {
    id: item.id,
    section: item.section,
    title: item.title,
    requirement: item.requirement,
    proofType: item.proofType,
    required: item.required,
    assignedRole: item.assignedRole,
    approverRoles: parseApproverRoles(item.approverRolesJson),
    weight: item.weight,
    failureCategory: item.failureCategory,
  };
}

function itemPayload(item: ItemDraft, sortOrder: number) {
  return {
    section: item.section,
    title: item.title,
    requirement: item.requirement,
    proofType: item.proofType,
    required: item.required,
    assignedRole: item.assignedRole,
    approverRolesJson: JSON.stringify(item.approverRoles),
    weight: item.weight,
    failureCategory: item.failureCategory,
    sortOrder,
  };
}

export default function TemplatesPage({ profile }: Props) {
  const { t } = useLang();
  const formRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [reportType, setReportType] = useState('Daily Hygiene');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateActive, setEditingTemplateActive] = useState(false);
  const [originalItemIds, setOriginalItemIds] = useState<Set<string>>(new Set());
  const [prevStoreIds, setPrevStoreIds] = useState<string[]>([]);

  const { data } = db.useQuery({ stores: {}, templates: { items: {}, stores: {} } });
  const stores: Store[] = (data?.stores ?? []) as Store[];
  const templates: Template[] = (data?.templates ?? []) as Template[];

  const isEditMode = editingTemplateId !== null;

  if (!canEditMaster(profile.role)) {
    return <div className="card">{t.templates.noPermission}</div>;
  }

  function resetForm() {
    setName('');
    setReportType('Daily Hygiene');
    setStoreIds([]);
    setItems([]);
    setEditingTemplateId(null);
    setEditingTemplateName('');
    setEditingTemplateActive(false);
    setOriginalItemIds(new Set());
    setPrevStoreIds([]);
  }

  function loadTemplateForEdit(template: Template) {
    const templateItems = [...((template.items ?? []) as TemplateItem[])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    const linkedStoreIds = (template.stores ?? []).map((s: Store) => s.id);

    setEditingTemplateId(template.id);
    setEditingTemplateName(template.name);
    setEditingTemplateActive(template.active);
    setOriginalItemIds(new Set(templateItems.map((i) => i.id)));
    setPrevStoreIds(linkedStoreIds);
    setName(template.name);
    setReportType(template.reportType);
    setStoreIds(linkedStoreIds);
    setItems(templateItems.map(templateItemToDraft));

    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        approverRoles: [...DEFAULT_APPROVER_ROLES],
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

  function buildEditConfirmMessage(): string {
    const parts = [t.templates.editWarning];
    if (editingTemplateActive) parts.push(t.templates.activeEditWarning);
    const draftIds = new Set(items.map((i) => i.id));
    const hasRemoved = [...originalItemIds].some((oid) => !draftIds.has(oid));
    if (hasRemoved) parts.push(t.templates.removeItemWarning);
    return parts.join('\n\n');
  }

  async function saveCreate() {
    const templateId = id();

    const templateTx = db.tx.templates[templateId].update({
      name: name.trim(),
      reportType,
      scheduleJson: JSON.stringify({ enabled: false }),
      active: true,
      createdByUserId: profile.userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const storeLinkTxs = storeIds.map((sid) =>
      db.tx.templates[templateId].link({ stores: sid }),
    );

    const itemTxs = items.map((item, i) => {
      const itemId = id();
      return db.tx.templateItems[itemId]
        .update(itemPayload(item, i))
        .link({ template: templateId });
    });

    await db.transact([templateTx, ...storeLinkTxs, ...itemTxs]);
    resetForm();
  }

  async function saveEdit() {
    if (!editingTemplateId) return;
    if (!confirm(buildEditConfirmMessage())) return;

    const templateTx = db.tx.templates[editingTemplateId].update({
      name: name.trim(),
      reportType,
      updatedAt: nowIso(),
    });

    const storeIdSet = new Set(storeIds);
    const prevSet = new Set(prevStoreIds);
    const storeLinkTxs = storeIds
      .filter((sid) => !prevSet.has(sid))
      .map((sid) => db.tx.templates[editingTemplateId].link({ stores: sid }));
    const storeUnlinkTxs = prevStoreIds
      .filter((sid) => !storeIdSet.has(sid))
      .map((sid) => db.tx.templates[editingTemplateId].unlink({ stores: sid }));

    const draftIds = new Set(items.map((i) => i.id));
    const removedItemIds = [...originalItemIds].filter((oid) => !draftIds.has(oid));

    const itemUpdateTxs = items.map((item, i) => {
      if (originalItemIds.has(item.id)) {
        return db.tx.templateItems[item.id].update(itemPayload(item, i));
      }
      const newItemId = id();
      return db.tx.templateItems[newItemId]
        .update(itemPayload(item, i))
        .link({ template: editingTemplateId });
    });

    const itemDeleteTxs = removedItemIds.map((removedId) =>
      db.tx.templateItems[removedId].delete(),
    );

    await db.transact([
      templateTx,
      ...storeLinkTxs,
      ...storeUnlinkTxs,
      ...itemUpdateTxs,
      ...itemDeleteTxs,
    ]);
    resetForm();
    alert(t.templates.updateSuccess);
  }

  async function save() {
    if (saving) return;
    if (!name.trim()) return alert(t.templates.nameRequired);
    if (!items.length) return alert(t.templates.itemRequired);
    setSaving(true);
    try {
      if (isEditMode) await saveEdit();
      else await saveCreate();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.templates.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(template: Template) {
    if (!confirm(`Deactivate "${template.name}"?`)) return;
    await db.transact(db.tx.templates[template.id].update({ active: false, updatedAt: nowIso() }));
    if (editingTemplateId === template.id) resetForm();
  }

  return (
    <div>
      <div className="card">
        <h1>{t.templates.title}</h1>
      </div>

      <div className="card" ref={formRef}>
        <h2>{isEditMode ? t.templates.editTemplate : t.templates.createTemplate}</h2>
        {isEditMode && (
          <p className="small" style={{ marginTop: 0 }}>
            {t.templates.editingLabel}: <strong>{editingTemplateName}</strong>
          </p>
        )}

        <div className="grid two">
          <label>
            {t.common.name}
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {t.templates.reportType}
            <input value={reportType} onChange={(e) => setReportType(e.target.value)} />
          </label>
        </div>

        <label style={{ marginTop: 12, display: 'block' }}>
          {t.templates.assignStores}
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
          {t.templates.addChecklistItem}
        </button>

        {items.map((item, i) => (
          <div className="item-card" key={item.id} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{t.templates.itemN} {i + 1}</h3>
              <button
                className="danger"
                style={{ padding: '4px 10px', minHeight: 32, fontSize: 12 }}
                onClick={() => removeItem(item.id)}
              >
                {t.common.delete}
              </button>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <input
                placeholder={t.common.section}
                value={item.section}
                onChange={(e) => updateItem(item.id, { section: e.target.value })}
              />
              <input
                placeholder={t.common.title}
                value={item.title}
                onChange={(e) => updateItem(item.id, { title: e.target.value })}
              />
              <textarea
                placeholder={t.templates.requirement}
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
                {t.templates.assignedRole}
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
                {t.templates.failureCategory}
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
              {t.common.required}
            </label>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving}>
            {saving
              ? isEditMode
                ? t.templates.savingChanges
                : t.templates.creating
              : isEditMode
                ? t.templates.saveChanges
                : t.templates.createTemplate}
          </button>
          {isEditMode && (
            <button className="secondary" onClick={resetForm} disabled={saving}>
              {t.templates.cancelEdit}
            </button>
          )}
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t.common.name}</th>
              <th>{t.common.type}</th>
              <th>{t.templates.storesAssigned}</th>
              <th>{t.staffHome.items}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tmpl) => (
              <tr key={tmpl.id}>
                <td>
                  <strong>{tmpl.name}</strong>
                </td>
                <td>{tmpl.reportType}</td>
                <td className="small">
                  {(tmpl.stores ?? []).map((s: Store) => s.code).join(', ') || '—'}
                </td>
                <td>{(tmpl.items as TemplateItem[] ?? []).length}</td>
                <td>
                  <span className={tmpl.active ? 'badge good' : 'badge bad'}>
                    {tmpl.active ? t.common.active : t.common.inactive}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="secondary"
                      style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                      onClick={() => loadTemplateForEdit(tmpl)}
                      disabled={editingTemplateId === tmpl.id}
                    >
                      {t.templates.edit}
                    </button>
                    {tmpl.active && (
                      <button
                        className="danger"
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => deactivate(tmpl)}
                      >
                        {t.templates.deactivate}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!templates.length && (
              <tr>
                <td colSpan={6}>{t.templates.noTemplates}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
