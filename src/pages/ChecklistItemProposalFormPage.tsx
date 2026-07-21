import { useMemo, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  FAILURE_CATEGORIES,
  PROOF_TYPES,
  canProposeTemplateItem,
  failureCategoryOptions,
  getOrderedRoles,
  userCanAccessStore,
} from '../lib/roles';
import {
  createChecklistItemProposal,
  findSimilarChecklistItemsAndProposals,
  type ProposalItemFields,
} from '../lib/checklistItemProposals';
import { parseTemplateSchedule } from '../lib/templateSchedule';
import type { ChecklistItemProposal, Profile, Store, Template, TemplateItem } from '../types';

export interface ProposalFormPrefill {
  templateId?: string;
  storeId?: string;
  sourceReportId?: string;
}

interface Props {
  profile: Profile;
  prefill?: ProposalFormPrefill | null;
  onDone: (proposalId?: string) => void;
  onCancel: () => void;
}

export default function ChecklistItemProposalFormPage({
  profile,
  prefill,
  onDone,
  onCancel,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const cp = t.checklistProposals;

  const { data } = db.useQuery({
    templates: { items: {}, stores: {} },
    stores: {},
    profiles: { stores: {} },
    checklistItemProposals: {},
  });

  const templates = (data?.templates ?? []) as Template[];
  const stores = (data?.stores ?? []) as Store[];
  const profiles = (data?.profiles ?? []) as Profile[];
  const existingProposals = (data?.checklistItemProposals ?? []) as ChecklistItemProposal[];

  const actorStoreIds = (profile.stores ?? []).map((s) => s.id);
  const accessibleStores = stores.filter((s) =>
    userCanAccessStore(profile.role, actorStoreIds, s.id, defs),
  );

  const accessibleTemplates = templates.filter((tpl) => {
    const tplStores = (tpl.stores ?? []) as Store[];
    if (!tplStores.length) return canProposeTemplateItem(profile.role, defs);
    return tplStores.some((s) => userCanAccessStore(profile.role, actorStoreIds, s.id, defs));
  });

  const [templateId, setTemplateId] = useState(prefill?.templateId ?? '');
  const [storeId, setStoreId] = useState(prefill?.storeId ?? '');
  const [section, setSection] = useState('');
  const [title, setTitle] = useState('');
  const [requirement, setRequirement] = useState('');
  const [reason, setReason] = useState('');
  const [proofType, setProofType] = useState<string>(PROOF_TYPES[0]);
  const [assignedRole, setAssignedRole] = useState('staff');
  const [failureCategory, setFailureCategory] = useState<string>(FAILURE_CATEGORIES[0]);
  const [required, setRequired] = useState(true);
  const [completionTime, setCompletionTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedTemplate = accessibleTemplates.find((t) => t.id === templateId);
  const scheduleEnabled = selectedTemplate
    ? parseTemplateSchedule(selectedTemplate.scheduleJson).enabled
    : false;

  const templateStores = ((selectedTemplate?.stores ?? []) as Store[]).filter((s) =>
    userCanAccessStore(profile.role, actorStoreIds, s.id, defs),
  );

  const similar = useMemo(() => {
    if (!selectedTemplate || !title.trim()) return [];
    return findSimilarChecklistItemsAndProposals({
      title,
      requirement,
      templateItems: (selectedTemplate.items ?? []) as TemplateItem[],
      proposals: existingProposals.filter((p) => p.templateId === selectedTemplate.id),
    });
  }, [selectedTemplate, title, requirement, existingProposals]);

  if (!canProposeTemplateItem(profile.role, defs)) {
    return (
      <div className="card">
        <p>{cp.proposeOnlySubleader}</p>
        <button type="button" className="secondary" onClick={onCancel}>
          {t.common.back}
        </button>
      </div>
    );
  }

  function buildFields(): ProposalItemFields {
    return {
      section,
      title,
      requirement,
      reason,
      proofType,
      assignedRole,
      failureCategory,
      required,
      completionTime: scheduleEnabled ? completionTime : '',
      supportingEvidenceJson: notes.trim() ? JSON.stringify({ notes: notes.trim() }) : '',
      sourceReportId: prefill?.sourceReportId ?? '',
      duplicateOverrideReason,
    };
  }

  async function save(submitNow: boolean) {
    if (!selectedTemplate) return alert(t.submit.selectStoreTemplateFirst);
    if (!storeId) return alert(t.submit.selectStoreTemplateFirst);
    setBusy(true);
    try {
      const proposalId = await createChecklistItemProposal({
        actor: profile,
        defs,
        template: selectedTemplate,
        sourceStoreId: storeId,
        fields: buildFields(),
        profiles,
        submitNow,
        existingProposals,
      });
      onDone(proposalId);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const roles = getOrderedRoles(defs);

  return (
    <div>
      <div className="card">
        <button type="button" className="secondary" onClick={onCancel}>
          {t.common.back}
        </button>
        <h1 style={{ marginTop: 12 }}>{cp.newProposal}</h1>
        <p className="small">{cp.affectedStoresInfo}</p>

        <label>
          {cp.targetTemplate}
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setStoreId('');
            }}
          >
            <option value="">{t.common.search}</option>
            {accessibleTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({tpl.reportType})
              </option>
            ))}
          </select>
        </label>

        <label>
          {cp.sourceStore}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">{t.common.selectStore}</option>
            {(templateStores.length ? templateStores : accessibleStores).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>

        <p className="small">{cp.storeScopeNote}</p>

        <div className="grid two">
          <label>
            {cp.section}
            <input value={section} onChange={(e) => setSection(e.target.value)} />
          </label>
          <label>
            {cp.itemTitle}
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>

        <label>
          {cp.requirement}
          <textarea value={requirement} onChange={(e) => setRequirement(e.target.value)} rows={3} />
        </label>

        <label>
          {cp.reason}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>

        <div className="grid two">
          <label>
            {cp.proofType}
            <select value={proofType} onChange={(e) => setProofType(e.target.value)}>
              {PROOF_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            {cp.assignedRole}
            <select value={assignedRole} onChange={(e) => setAssignedRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid two">
          <label>
            {cp.failureCategory}
            <select
              value={failureCategory}
              onChange={(e) => setFailureCategory(e.target.value)}
            >
              {failureCategoryOptions(failureCategory).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-checkbox-label" style={{ marginTop: 24 }}>
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            {required ? cp.required : cp.optional}
          </label>
        </div>

        {scheduleEnabled && (
          <label>
            {cp.completionTime}
            <input
              type="time"
              value={completionTime}
              onChange={(e) => setCompletionTime(e.target.value)}
            />
          </label>
        )}

        <label>
          {cp.supportingNotes}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        {similar.length > 0 && (
          <div className="card" style={{ background: 'var(--warn-bg, #fff8e6)' }}>
            <p>
              <strong>{cp.similarWarning}</strong>
            </p>
            {similar.map((m) => (
              <p key={`${m.kind}-${m.id}`} className="small">
                {m.kind === 'item' ? cp.similarItem : cp.similarProposal}: {m.title} ({m.section}
                {m.status ? ` · ${m.status}` : ''})
              </p>
            ))}
            <label>
              {cp.similarExplain}
              <textarea
                value={duplicateOverrideReason}
                onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                rows={2}
              />
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="secondary" disabled={busy} onClick={() => save(false)}>
            {cp.saveDraft}
          </button>
          <button type="button" disabled={busy} onClick={() => save(true)}>
            {cp.submitProposal}
          </button>
        </div>
      </div>
    </div>
  );
}
