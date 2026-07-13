import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';
import {
  MAX_IMPORT_FILE_BYTES,
  parseImportJsonText,
  type ParsedImportRoot,
} from '../lib/templateTransfer';
import {
  buildCreateImportDrafts,
  buildImportConfirmMessage,
  buildUpdateDiff,
  buildUpdateImportDrafts,
  validateImportFile,
  type UpdateDiff,
  type ValidationResult,
} from '../lib/templateValidation';
import { createTemplate, updateTemplate } from '../lib/templatePersistence';
import type { Profile, Store, Template } from '../types';

type ImportMode = 'create' | 'update';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  stores: Store[];
  templates: Template[];
  onSuccess: (templateId: string) => void;
}

export default function TemplateImportModal({
  open,
  onClose,
  profile,
  stores,
  templates,
  onSuccess,
}: Props) {
  const { t } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [parsedRoot, setParsedRoot] = useState<ParsedImportRoot | null>(null);
  const [parseError, setParseError] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [mode, setMode] = useState<ImportMode>('create');
  const [createName, setCreateName] = useState('');
  const [targetTemplateId, setTargetTemplateId] = useState('');
  const [excludeUnknownStores, setExcludeUnknownStores] = useState(false);
  const [ackDuplicateName, setAckDuplicateName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFileName('');
    setParsedRoot(null);
    setParseError('');
    setValidation(null);
    setMode('create');
    setCreateName('');
    setTargetTemplateId('');
    setExcludeUnknownStores(false);
    setAckDuplicateName(false);
    setSaving(false);
    setSaveError('');
  }, [open]);

  useEffect(() => {
    if (!parsedRoot) {
      setValidation(null);
      return;
    }
    const result = validateImportFile(parsedRoot, stores, {
      excludeUnknownStores,
      existingTemplateNames: mode === 'create' ? templates.map((tmpl) => tmpl.name) : undefined,
      createNameOverride: mode === 'create' && createName.trim() ? createName : undefined,
    });
    setValidation(result);
    if (mode === 'create' && !createName.trim() && result.normalized) {
      setCreateName(result.normalized.name);
    }
  }, [parsedRoot, stores, excludeUnknownStores, mode, createName, templates]);

  if (!open) return null;

  const targetTemplate = templates.find((tmpl) => tmpl.id === targetTemplateId) ?? null;
  const updateDiff: UpdateDiff | null =
    validation?.normalized && targetTemplate
      ? buildUpdateDiff(validation.normalized, targetTemplate, stores)
      : null;

  const hasDuplicateNameWarning = validation?.warnings.some((w) => w.path === 'template.name') ?? false;
  const blockingErrors = validation?.errors ?? [];
  const canProceedBase = Boolean(validation?.ok && validation.normalized);
  const needsDuplicateAck = mode === 'create' && hasDuplicateNameWarning && !ackDuplicateName;
  const needsTarget = mode === 'update' && !targetTemplateId;
  const canSave = canProceedBase && !needsDuplicateAck && !needsTarget && !saving;

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParseError('');
    setParsedRoot(null);
    setValidation(null);
    setSaveError('');
    setAckDuplicateName(false);

    if (!file) {
      setFileName('');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.json')) {
      setParseError(t.templates.importInvalidExtension);
      setFileName(file.name);
      return;
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setParseError(t.templates.importFileTooLarge);
      setFileName(file.name);
      return;
    }

    setFileName(file.name);

    try {
      const text = await file.text();
      const root = parseImportJsonText(text);
      setParsedRoot(root);
      setCreateName('');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : t.templates.importParseFailed);
    }
  }

  async function handleSave() {
    if (!canSave || !validation?.normalized) return;

    const normalized = validation.normalized;
    const confirmMsg =
      mode === 'create'
        ? buildImportConfirmMessage({
            editWarning: t.templates.editWarning,
            activeEditWarning: t.templates.activeEditWarning,
            removeItemWarning: t.templates.removeItemWarning,
            targetActive: normalized.active,
            hasRemovedItems: false,
            mode: 'create',
            createSuccessLabel: t.templates.importCreateConfirm,
          })
        : buildImportConfirmMessage({
            editWarning: t.templates.editWarning,
            activeEditWarning: t.templates.activeEditWarning,
            removeItemWarning: t.templates.removeItemWarning,
            targetActive: targetTemplate?.active ?? false,
            hasRemovedItems: (updateDiff?.itemsToRemove ?? 0) > 0,
            mode: 'update',
          });

    if (!confirm(confirmMsg)) return;

    setSaving(true);
    setSaveError('');

    try {
      if (mode === 'create') {
        const items = buildCreateImportDrafts(normalized.items);
        const templateId = await createTemplate({
          profileUserId: profile.userId,
          name: createName.trim() || normalized.name,
          reportType: normalized.reportType,
          scheduleJson: normalized.scheduleJson,
          active: normalized.active,
          storeIds: normalized.storeIds,
          items,
        });
        alert(t.templates.importCreateSuccess);
        onSuccess(templateId);
        onClose();
        return;
      }

      if (!targetTemplate) return;

      const targetItemIds = new Set(
        ((targetTemplate.items ?? []) as { id: string }[]).map((i) => i.id),
      );
      const prevStoreIds = (targetTemplate.stores ?? []).map((s: Store) => s.id);
      const items = buildUpdateImportDrafts(normalized.items, targetItemIds);

      await updateTemplate({
        templateId: targetTemplate.id,
        name: normalized.name,
        reportType: normalized.reportType,
        scheduleJson: normalized.scheduleJson,
        active: normalized.active,
        storeIds: normalized.storeIds,
        prevStoreIds,
        items,
        originalItemIds: targetItemIds,
      });

      alert(t.templates.importUpdateSuccess);
      onSuccess(targetTemplate.id);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t.templates.importSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="export-modal-overlay template-import-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-import-title"
    >
      <div className="export-modal card template-import-modal">
        <h2 id="template-import-title" style={{ marginTop: 0 }}>
          {t.templates.importTitle}
        </h2>

        <section className="template-import-section">
          <h3>{t.templates.importStepFile}</h3>
          <label className="template-import-file-label">
            {t.templates.importSelectFile}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              disabled={saving}
            />
          </label>
          {fileName ? <p className="small">{fileName}</p> : null}
          {parseError ? (
            <p className="export-status export-status-error" role="alert">
              {parseError}
            </p>
          ) : null}
        </section>

        {validation ? (
          <section className="template-import-section">
            <h3>{t.templates.importStepPreview}</h3>
            <dl className="template-import-summary">
              <div>
                <dt>{t.templates.importFileSchema}</dt>
                <dd>{validation.fileSchema ?? '—'}</dd>
              </div>
              <div>
                <dt>{t.templates.importFileVersion}</dt>
                <dd>{validation.fileVersion ?? '—'}</dd>
              </div>
              {validation.normalized ? (
                <>
                  <div>
                    <dt>{t.common.name}</dt>
                    <dd>{validation.normalized.name}</dd>
                  </div>
                  <div>
                    <dt>{t.templates.reportType}</dt>
                    <dd>{validation.normalized.reportType}</dd>
                  </div>
                  <div>
                    <dt>{t.common.status}</dt>
                    <dd>
                      {validation.normalized.active ? t.common.active : t.common.inactive}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.staffHome.items}</dt>
                    <dd>{validation.normalized.items.length}</dd>
                  </div>
                  <div>
                    <dt>{t.templates.importMatchedStores}</dt>
                    <dd>
                      {validation.normalized.matchedStoreCodes.length
                        ? validation.normalized.matchedStoreCodes.join(', ')
                        : t.common.none}
                    </dd>
                  </div>
                  {validation.normalized.unknownStoreCodes.length > 0 ? (
                    <div>
                      <dt>{t.templates.importUnknownStores}</dt>
                      <dd>{validation.normalized.unknownStoreCodes.join(', ')}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>

            {blockingErrors.length > 0 ? (
              <ul className="template-import-issues" role="alert">
                {blockingErrors.map((issue, idx) => (
                  <li key={`err-${idx}`} className="template-import-issue-error">
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {validation.warnings.length > 0 ? (
              <ul className="template-import-issues">
                {validation.warnings.map((issue, idx) => (
                  <li key={`warn-${idx}`} className="template-import-issue-warning">
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {validation.normalized?.unknownStoreCodes.length ? (
              <label className="template-import-checkbox">
                <input
                  type="checkbox"
                  checked={excludeUnknownStores}
                  onChange={(e) => setExcludeUnknownStores(e.target.checked)}
                  disabled={saving}
                />
                {t.templates.importExcludeUnknownStores}
              </label>
            ) : null}
          </section>
        ) : null}

        {canProceedBase ? (
          <section className="template-import-section">
            <h3>{t.templates.importStepMode}</h3>
            <fieldset className="template-import-mode">
              <legend className="sr-only">{t.templates.importStepMode}</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="create"
                  checked={mode === 'create'}
                  onChange={() => {
                    setMode('create');
                    setTargetTemplateId('');
                  }}
                  disabled={saving}
                />
                {t.templates.importModeCreate}
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="update"
                  checked={mode === 'update'}
                  onChange={() => setMode('update')}
                  disabled={saving}
                />
                {t.templates.importModeUpdate}
              </label>
            </fieldset>

            {mode === 'create' ? (
              <label>
                {t.templates.importCreateName}
                <input
                  value={createName}
                  onChange={(e) => {
                    setCreateName(e.target.value);
                    setAckDuplicateName(false);
                  }}
                  disabled={saving}
                />
              </label>
            ) : (
              <label>
                {t.templates.importTargetTemplate}
                <select
                  value={targetTemplateId}
                  onChange={(e) => setTargetTemplateId(e.target.value)}
                  disabled={saving}
                >
                  <option value="">{t.templates.importSelectTarget}</option>
                  {templates.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {hasDuplicateNameWarning && mode === 'create' ? (
              <label className="template-import-checkbox">
                <input
                  type="checkbox"
                  checked={ackDuplicateName}
                  onChange={(e) => setAckDuplicateName(e.target.checked)}
                  disabled={saving}
                />
                {t.templates.importAckDuplicateName}
              </label>
            ) : null}

            {mode === 'update' && updateDiff ? (
              <div className="template-import-diff">
                <p className="small">{t.templates.importDiffSummary}</p>
                <ul className="small">
                  {updateDiff.templateFieldChanges.length > 0 ? (
                    <li>
                      {t.templates.importFieldsChange}: {updateDiff.templateFieldChanges.join(', ')}
                    </li>
                  ) : null}
                  {updateDiff.activeWillChange ? (
                    <li>{t.templates.importActiveChange}</li>
                  ) : null}
                  {updateDiff.storesToAdd.length > 0 ? (
                    <li>
                      {t.templates.importStoresAdd}: {updateDiff.storesToAdd.join(', ')}
                    </li>
                  ) : null}
                  {updateDiff.storesToRemove.length > 0 ? (
                    <li>
                      {t.templates.importStoresRemove}: {updateDiff.storesToRemove.join(', ')}
                    </li>
                  ) : null}
                  <li>
                    {t.templates.importItemsUpdate}: {updateDiff.itemsToUpdate}
                  </li>
                  <li>
                    {t.templates.importItemsCreate}: {updateDiff.itemsToCreate}
                  </li>
                  <li>
                    {t.templates.importItemsRemove}: {updateDiff.itemsToRemove}
                  </li>
                </ul>
                {updateDiff.removedItemTitles.length > 0 ? (
                  <p className="small template-import-removed-list">
                    {t.templates.importRemovedItems}: {updateDiff.removedItemTitles.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {saveError ? (
          <p className="export-status export-status-error" role="alert">
            {saveError}
          </p>
        ) : null}

        <div className="export-modal-actions">
          <button type="button" className="secondary" onClick={handleClose} disabled={saving}>
            {t.common.cancel}
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? t.templates.importSaving : t.templates.importSave}
          </button>
        </div>
      </div>
    </div>
  );
}
