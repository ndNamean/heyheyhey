import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canEditMaster, failureCategoryOptions, isOwner, PROOF_TYPES } from '../lib/roles';
import { nowIso, todayYmd } from '../lib/utils';
import {
  createTemplate,
  deleteTemplate,
  templateItemToDraft,
  updateTemplate,
  type TemplateItemDraft,
} from '../lib/templatePersistence';
import {
  ALL_DAYS_OF_WEEK,
  DEFAULT_SCHEDULE_TIMEZONE,
  DISABLED_SCHEDULE,
  WEEKDAYS,
  WEEKENDS,
  effectiveFromIso,
  effectiveFromYmd,
  parseTemplateSchedule,
  serializeTemplateSchedule,
  summarizeSchedule,
  validateTemplateSchedule,
  type ScheduleRecurrence,
  type TemplateSchedule,
} from '../lib/templateSchedule';
import TemplateImportModal from '../components/TemplateImportModal';
import TemplateExportMenu from '../components/TemplateExportMenu';
import StorePicker from '../components/StorePicker';
import type { Profile, Store, Template, TemplateItem, TemplateScheduleVersion } from '../types';

interface Props {
  profile: Profile;
}

const WEEKDAY_ORDER = [...ALL_DAYS_OF_WEEK];

function emptyScheduleForm() {
  return {
    enabled: false as boolean,
    recurrence: 'daily' as ScheduleRecurrence,
    dailyDaysOfWeek: [...ALL_DAYS_OF_WEEK] as number[],
    weeklyDayOfWeek: 1,
    monthlyDayOfMonth: 1 as number | 'last',
    effectiveFrom: todayYmd(),
    itemDueTimes: {} as Record<string, string>,
  };
}

function scheduleFromForm(form: ReturnType<typeof emptyScheduleForm>): TemplateSchedule {
  if (!form.enabled) return { ...DISABLED_SCHEDULE };

  const schedule: TemplateSchedule = {
    version: 2,
    enabled: true,
    recurrence: form.recurrence,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    effectiveFrom: effectiveFromIso(form.effectiveFrom),
    itemDueTimes: { ...form.itemDueTimes },
  };

  if (form.recurrence === 'daily') {
    schedule.daily = { daysOfWeek: [...form.dailyDaysOfWeek] };
  } else if (form.recurrence === 'weekly') {
    schedule.weekly = { dayOfWeek: form.weeklyDayOfWeek };
  } else {
    schedule.monthly = { dayOfMonth: form.monthlyDayOfMonth };
  }

  return schedule;
}

function formFromSchedule(schedule: TemplateSchedule) {
  const base = emptyScheduleForm();
  if (!schedule.enabled) return base;

  return {
    enabled: true,
    recurrence: schedule.recurrence ?? 'daily',
    dailyDaysOfWeek: schedule.daily?.daysOfWeek?.length
      ? [...schedule.daily.daysOfWeek]
      : [...ALL_DAYS_OF_WEEK],
    weeklyDayOfWeek: schedule.weekly?.dayOfWeek ?? 1,
    monthlyDayOfMonth: schedule.monthly?.dayOfMonth ?? 1,
    effectiveFrom: effectiveFromYmd(schedule.effectiveFrom) || todayYmd(),
    itemDueTimes: { ...(schedule.itemDueTimes ?? {}) },
  };
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
  const [prevScheduleJson, setPrevScheduleJson] = useState(serializeTemplateSchedule(DISABLED_SCHEDULE));

  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [applyAllTime, setApplyAllTime] = useState('09:00');
  const [scheduleFieldErrors, setScheduleFieldErrors] = useState<Record<string, string>>({});

  const { data } = db.useQuery({
    stores: {},
    templates: {
      items: { responses: {} },
      stores: {},
      scheduleVersions: {},
      reports: {},
      slots: {},
      checklistItemProposals: {},
    },
  });
  const stores: Store[] = (data?.stores ?? []) as Store[];
  const templates: Template[] = (data?.templates ?? []) as Template[];
  const ownerCanDelete = isOwner(profile.role);

  const isEditMode = editingTemplateId !== null;

  const weekdayLabels: Record<number, string> = {
    1: t.templates.weekdayMon,
    2: t.templates.weekdayTue,
    3: t.templates.weekdayWed,
    4: t.templates.weekdayThu,
    5: t.templates.weekdayFri,
    6: t.templates.weekdaySat,
    0: t.templates.weekdaySun,
  };

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
    setPrevScheduleJson(serializeTemplateSchedule(DISABLED_SCHEDULE));
    setScheduleForm(emptyScheduleForm());
    setApplyAllTime('09:00');
    setScheduleFieldErrors({});
  }

  function loadTemplateForEdit(template: Template) {
    const templateItems = [...((template.items ?? []) as TemplateItem[])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    const linkedStoreIds = (template.stores ?? []).map((s: Store) => s.id);
    const schedule = parseTemplateSchedule(template.scheduleJson);

    setEditingTemplateId(template.id);
    setEditingTemplateName(template.name);
    setEditingTemplateActive(template.active);
    setOriginalItemIds(new Set(templateItems.map((i) => i.id)));
    setPrevStoreIds(linkedStoreIds);
    setPrevScheduleJson(template.scheduleJson || serializeTemplateSchedule(DISABLED_SCHEDULE));
    setName(template.name);
    setReportType(template.reportType);
    setStoreIds(linkedStoreIds);
    setItems(templateItems.map(templateItemToDraft));
    setScheduleForm(formFromSchedule(schedule));
    setScheduleFieldErrors({});

    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleImportSuccess(templateId: string) {
    setPendingOpenTemplateId(templateId);
  }

  function addItem() {
    const newId = crypto.randomUUID();
    setItems((prev) => [
      ...prev,
      {
        id: newId,
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
    setScheduleForm((prev) => {
      const nextTimes = { ...prev.itemDueTimes };
      delete nextTimes[itemId];
      return { ...prev, itemDueTimes: nextTimes };
    });
  }

  function setItemDueTime(itemId: string, time: string) {
    setScheduleForm((prev) => ({
      ...prev,
      itemDueTimes: { ...prev.itemDueTimes, [itemId]: time },
    }));
    setScheduleFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`itemDueTime:${itemId}`];
      return next;
    });
  }

  function applyCompletionTimeToAll() {
    if (!applyAllTime) return;
    const nextTimes: Record<string, string> = { ...scheduleForm.itemDueTimes };
    for (const item of items) {
      nextTimes[item.id] = applyAllTime;
    }
    setScheduleForm((prev) => ({ ...prev, itemDueTimes: nextTimes }));
    setScheduleFieldErrors((prev) => {
      const next = { ...prev };
      for (const item of items) delete next[`itemDueTime:${item.id}`];
      return next;
    });
  }

  function toggleDailyDay(day: number) {
    setScheduleForm((prev) => {
      const has = prev.dailyDaysOfWeek.includes(day);
      const dailyDaysOfWeek = has
        ? prev.dailyDaysOfWeek.filter((d) => d !== day)
        : [...prev.dailyDaysOfWeek, day];
      return { ...prev, dailyDaysOfWeek };
    });
  }

  function buildEditConfirmMessage(): string {
    const parts = [t.templates.editWarning];
    if (editingTemplateActive) parts.push(t.templates.activeEditWarning);
    const draftIds = new Set(items.map((i) => i.id));
    const hasRemoved = [...originalItemIds].some((oid) => !draftIds.has(oid));
    if (hasRemoved) parts.push(t.templates.removeItemWarning);
    return parts.join('\n\n');
  }

  function validateScheduleOrAlert(): TemplateSchedule | null {
    const schedule = scheduleFromForm(scheduleForm);
    const issues = validateTemplateSchedule(
      schedule,
      items.map((i) => ({ id: i.id, required: i.required })),
    );
    if (!issues.length) {
      setScheduleFieldErrors({});
      return schedule;
    }

    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      fieldErrors[issue.field] = issue.message;
    }
    setScheduleFieldErrors(fieldErrors);

    if (issues.some((i) => i.field.startsWith('itemDueTime:'))) {
      alert(t.templates.scheduleValidationItemTimes);
    } else if (issues.some((i) => i.field === 'recurrence')) {
      alert(t.templates.scheduleValidationRecurrence);
    } else if (issues.some((i) => i.field === 'daily')) {
      alert(t.templates.scheduleValidationDays);
    } else if (issues.some((i) => i.field === 'weekly')) {
      alert(t.templates.scheduleValidationWeeklyDay);
    } else if (issues.some((i) => i.field === 'monthly')) {
      alert(t.templates.scheduleValidationMonthlyDay);
    } else if (issues.some((i) => i.field === 'effectiveFrom')) {
      alert(t.templates.scheduleValidationEffectiveFrom);
    } else {
      alert(issues[0].message);
    }
    return null;
  }

  function openScheduleVersionIdFor(templateId: string): string | null {
    const template = templates.find((tmpl) => tmpl.id === templateId);
    const versions = (template?.scheduleVersions ?? []) as TemplateScheduleVersion[];
    const open = versions.find((v) => !v.effectiveTo);
    return open?.id ?? null;
  }

  async function saveCreate() {
    const schedule = validateScheduleOrAlert();
    if (!schedule) return;

    await createTemplate({
      profileUserId: profile.userId,
      name: name.trim(),
      reportType,
      scheduleJson: serializeTemplateSchedule(schedule),
      active: true,
      storeIds,
      items,
    });
    resetForm();
  }

  async function saveEdit() {
    if (!editingTemplateId) return;
    const schedule = validateScheduleOrAlert();
    if (!schedule) return;
    if (!confirm(buildEditConfirmMessage())) return;

    await updateTemplate({
      templateId: editingTemplateId,
      profileUserId: profile.userId,
      name: name.trim(),
      reportType,
      scheduleJson: serializeTemplateSchedule(schedule),
      prevScheduleJson,
      openScheduleVersionId: openScheduleVersionIdFor(editingTemplateId),
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

  async function removeTemplate(template: Template) {
    if (!ownerCanDelete) return;
    const msg = t.templates.deleteConfirm.replace('{name}', template.name);
    if (!confirm(msg)) return;
    try {
      await deleteTemplate(template);
      if (editingTemplateId === template.id) {
        resetForm();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t.templates.deleteFailed);
    }
  }

  const scheduleSummary = summarizeSchedule(scheduleFromForm(scheduleForm));

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

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>{t.templates.assignStores}</label>
          <StorePicker stores={stores} selectedStoreIds={storeIds} onChange={setStoreIds} />
        </div>

        <fieldset className="template-schedule-fieldset">
          <legend>{t.templates.scheduleTitle}</legend>

          <label className="ui-checkbox-label">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={scheduleForm.enabled}
              onChange={(e) =>
                setScheduleForm((prev) => ({ ...prev, enabled: e.target.checked }))
              }
            />
            {t.templates.scheduleEnable}
          </label>

          {scheduleForm.enabled && (
            <>
              {isEditMode && (
                <p className="small template-schedule-summary">
                  {t.templates.scheduleSummary}: <strong>{scheduleSummary}</strong>
                </p>
              )}

              <div className="template-schedule-recurrence" role="radiogroup" aria-label={t.templates.scheduleRecurrence}>
                {(
                  [
                    ['daily', t.templates.scheduleDaily],
                    ['weekly', t.templates.scheduleWeekly],
                    ['monthly', t.templates.scheduleMonthly],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className={`template-schedule-radio ${scheduleForm.recurrence === value ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="schedule-recurrence"
                      checked={scheduleForm.recurrence === value}
                      onChange={() => setScheduleForm((prev) => ({ ...prev, recurrence: value }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {scheduleFieldErrors.recurrence && (
                <p className="small template-schedule-error">{scheduleFieldErrors.recurrence}</p>
              )}

              {scheduleForm.recurrence === 'daily' && (
                <div style={{ marginTop: 12 }}>
                  <div className="small" style={{ marginBottom: 6 }}>{t.templates.scheduleRepeatOn}</div>
                  <div className="template-schedule-day-shortcuts">
                    <button type="button" className="secondary" onClick={() => setScheduleForm((p) => ({ ...p, dailyDaysOfWeek: [...ALL_DAYS_OF_WEEK] }))}>
                      {t.templates.scheduleEveryDay}
                    </button>
                    <button type="button" className="secondary" onClick={() => setScheduleForm((p) => ({ ...p, dailyDaysOfWeek: [...WEEKDAYS] }))}>
                      {t.templates.scheduleWeekdays}
                    </button>
                    <button type="button" className="secondary" onClick={() => setScheduleForm((p) => ({ ...p, dailyDaysOfWeek: [...WEEKENDS] }))}>
                      {t.templates.scheduleWeekends}
                    </button>
                  </div>
                  <div className="template-schedule-days">
                    {WEEKDAY_ORDER.map((day) => (
                      <label key={day} className="ui-checkbox-label">
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          checked={scheduleForm.dailyDaysOfWeek.includes(day)}
                          onChange={() => toggleDailyDay(day)}
                        />
                        {weekdayLabels[day]}
                      </label>
                    ))}
                  </div>
                  {scheduleFieldErrors.daily && (
                    <p className="small template-schedule-error">{scheduleFieldErrors.daily}</p>
                  )}
                </div>
              )}

              {scheduleForm.recurrence === 'weekly' && (
                <div style={{ marginTop: 12 }}>
                  <div className="small" style={{ marginBottom: 6 }}>{t.templates.scheduleDueEvery}</div>
                  <div className="template-schedule-days">
                    {WEEKDAY_ORDER.map((day) => (
                      <label key={day} className={`template-schedule-radio ${scheduleForm.weeklyDayOfWeek === day ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="weekly-day"
                          checked={scheduleForm.weeklyDayOfWeek === day}
                          onChange={() => setScheduleForm((p) => ({ ...p, weeklyDayOfWeek: day }))}
                        />
                        {weekdayLabels[day]}
                      </label>
                    ))}
                  </div>
                  {scheduleFieldErrors.weekly && (
                    <p className="small template-schedule-error">{scheduleFieldErrors.weekly}</p>
                  )}
                </div>
              )}

              {scheduleForm.recurrence === 'monthly' && (
                <div style={{ marginTop: 12 }}>
                  <label>
                    {t.templates.scheduleDueDayOfMonth}
                    <select
                      value={scheduleForm.monthlyDayOfMonth === 'last' ? 'last' : String(scheduleForm.monthlyDayOfMonth)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setScheduleForm((p) => ({
                          ...p,
                          monthlyDayOfMonth: v === 'last' ? 'last' : Number(v),
                        }));
                      }}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {t.templates.scheduleDayN.replace('{n}', String(n))}
                        </option>
                      ))}
                      <option value="last">{t.templates.scheduleLastDay}</option>
                    </select>
                  </label>
                  {scheduleFieldErrors.monthly && (
                    <p className="small template-schedule-error">{scheduleFieldErrors.monthly}</p>
                  )}
                </div>
              )}

              <div className="grid two" style={{ marginTop: 12 }}>
                <label>
                  {t.templates.scheduleEffectiveFrom}
                  <input
                    type="date"
                    value={scheduleForm.effectiveFrom}
                    onChange={(e) => setScheduleForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
                  />
                </label>
                <label>
                  {t.templates.scheduleTimezone}
                  <input value={DEFAULT_SCHEDULE_TIMEZONE} readOnly />
                </label>
              </div>
              {scheduleFieldErrors.effectiveFrom && (
                <p className="small template-schedule-error">{scheduleFieldErrors.effectiveFrom}</p>
              )}

              {items.length > 0 && (
                <div className="template-schedule-apply-all">
                  <label>
                    {t.templates.scheduleApplyTimeToAll}
                    <input
                      type="time"
                      value={applyAllTime}
                      onChange={(e) => setApplyAllTime(e.target.value)}
                    />
                  </label>
                  <button type="button" className="secondary" onClick={applyCompletionTimeToAll}>
                    {t.templates.scheduleApply}
                  </button>
                </div>
              )}
            </>
          )}
        </fieldset>

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
                  {['staff', 'leader', 'subleader', 'manager', 'areaManager', 'admin', 'owner'].map(
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
              {scheduleForm.enabled && (
                <label>
                  {t.templates.scheduleCompletionTime}
                  <input
                    type="time"
                    value={scheduleForm.itemDueTimes[item.id] ?? ''}
                    onChange={(e) => setItemDueTime(item.id, e.target.value)}
                  />
                  {scheduleFieldErrors[`itemDueTime:${item.id}`] && (
                    <span className="small template-schedule-error">
                      {t.templates.scheduleCompletionTimeRequired}
                    </span>
                  )}
                </label>
              )}
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
                  {parseTemplateSchedule(tmpl.scheduleJson).enabled && (
                    <div className="small" style={{ marginTop: 2 }}>
                      {summarizeSchedule(parseTemplateSchedule(tmpl.scheduleJson))}
                    </div>
                  )}
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
                    {ownerCanDelete && (
                      <button
                        className="danger"
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => removeTemplate(tmpl)}
                      >
                        {t.common.delete}
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
