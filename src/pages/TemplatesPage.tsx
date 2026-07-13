import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canEditMaster, failureCategoryOptions, PROOF_TYPES } from '../lib/roles';
import { nowIso } from '../lib/utils';
import {
  createTemplate,
  templateItemToDraft,
  updateTemplate,
  type TemplateItemDraft,
} from '../lib/templatePersistence';
import TemplateImportModal from '../components/TemplateImportModal';
import TemplateExportMenu from '../components/TemplateExportMenu';
import type { Profile, Store, Template, TemplateItem } from '../types';

interface Props {
  profile: Profile;
}

export default function TemplatesPage({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const formRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [reportType, setReportType] = useState('Daily Hygiene');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [items, setItems] = useState<TemplateItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingOpenTemplateId, setPendingOpenTemplateId] = useState<string | null>(null);

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateActive, setEditingTemplateActive] = useState(false);
  const [originalItemIds, setOriginalItemIds] = useState<Set<string>>(new Set());
  const [prevStoreIds, setPrevStoreIds] = useState<string[]>([]);

  const { data } = db.useQuery({ stores: {}, templates: { items: {}, stores: {} } });
  const stores: Store[] = (data?.stores ?? []) as Store[];
  const templates: Template[] = (data?.templates ?? []) as Template[];

  const isEditMode = editingTemplateId !== null;

  useEffect(() => {
    if (!pendingOpenTemplateId) return;
    const template = templates.find((tmpl) => tmpl.id === pendingOpenTemplateId);
    if (template) {
      loadTemplateForEdit(template);
      setPendingOpenTemplateId(null);
    }
  }, [templates, pendingOpenTemplateId]);

  if (!canEditMaster(profile.role, defs)) {
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

  function handleImportSuccess(templateId: string) {
    setPendingOpenTemplateId(templateId);
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

  function updateItem(itemId: string, patch: Partial<TemplateItemDraft>) {
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
    await createTemplate({
      profileUserId: profile.userId,
      name: name.trim(),
      reportType,
      scheduleJson: JSON.stringify({ enabled: false }),
      active: true,
      storeIds,
      items,
    });
    resetForm();
  }

  async function saveEdit() {
    if (!editingTemplateId) return;
    if (!confirm(buildEditConfirmMessage())) return;

    await updateTemplate({
      templateId: editingTemplateId,
      name: name.trim(),
      reportType,
      storeIds,
      prevStoreIds,
      items,
      originalItemIds,
    });
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
    if (editingTemplateId === template.id) {
      setEditingTemplateActive(false);
    }
  }

  async function activate(template: Template) {
    const msg = t.templates.activateConfirm.replace('{name}', template.name);
    if (!confirm(msg)) return;
    await db.transact(db.tx.templates[template.id].update({ active: true, updatedAt: nowIso() }));
    if (editingTemplateId === template.id) {
      setEditingTemplateActive(true);
    }
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: 0 }}>{t.templates.title}</h1>
          <button type="button" className="secondary" onClick={() => setImportOpen(true)}>
            {t.templates.importTemplate}
          </button>
        </div>
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
                <select
                  value={item.failureCategory}
                  onChange={(e) => updateItem(item.id, { failureCategory: e.target.value })}
                >
                  {failureCategoryOptions(item.failureCategory).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="ui-checkbox-label" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                className="ui-checkbox"
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
                    <TemplateExportMenu template={tmpl} allStores={stores} />
                    {tmpl.active ? (
                      <button
                        className="danger"
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => deactivate(tmpl)}
                      >
                        {t.templates.deactivate}
                      </button>
                    ) : (
                      <button
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => activate(tmpl)}
                      >
                        {t.templates.activate}
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

      <TemplateImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        profile={profile}
        stores={stores}
        templates={templates}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
