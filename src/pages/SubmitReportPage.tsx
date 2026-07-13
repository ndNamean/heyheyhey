import { useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { needsMedia, needsNote, needsNumber, seesAllTemplateItems, userCanAccessStore } from '../lib/roles';
import { calcCompletion, nowIso, todayYmd } from '../lib/utils';
import {
  buildItemResubmittedEvents,
  buildReportSubmittedEvents,
} from '../lib/reviewEvents';
import { BACK_PRIORITY, useNativeBack } from '../lib/nativeBack';
import TimemarkCamera from '../components/TimemarkCamera';
import type {
  LocalResponse,
  MediaRecord,
  Profile,
  Report,
  ReportResponse,
  Store,
  Template,
  TemplateItem,
  UploadedMedia,
} from '../types';

interface Props {
  profile: Profile;
  correctionReportId?: string | null;
  onCorrectionComplete?: () => void;
}

const EMPTY_RESPONSE: LocalResponse = {
  ticked: false,
  numberValue: '',
  note: '',
  mediaItems: [],
};

export default function SubmitReportPage({
  profile,
  correctionReportId = null,
  onCorrectionComplete,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const correctionMode = !!correctionReportId;
  const [newReportId] = useState(() => id());
  const [storeId, setStoreId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [reportDate, setReportDate] = useState(todayYmd);
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, LocalResponse>>({});
  const [responseIdByItem, setResponseIdByItem] = useState<Record<string, string>>({});
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [existingMediaIds, setExistingMediaIds] = useState<Set<string>>(new Set());
  const [correctionReady, setCorrectionReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cameraReviewPending, setCameraReviewPending] = useState(false);
  const correctionInitRef = useRef(false);

  const activeReportId = correctionReportId ?? newReportId;

  const { data } = db.useQuery({
    stores: {},
    templates: { items: {}, stores: {} },
    ...(correctionReportId
      ? {
          reports: {
            $: { where: { id: correctionReportId } },
            responses: { media: { file: {} } },
          },
        }
      : {}),
  });

  const correctionReport: Report | undefined = correctionReportId
    ? (((data?.reports ?? []) as Report[])[0] as Report | undefined)
    : undefined;

  const allStores: Store[] = (data?.stores ?? []) as Store[];
  const allTemplates: Template[] = (data?.templates ?? []) as Template[];

  const accessibleStores = allStores.filter(
    (s) => s.active && userCanAccessStore(profile.role, (profile.stores ?? []).map((st) => st.id), s.id, defs),
  );

  const selectedStore = accessibleStores.find((s) => s.id === storeId);
  const availableTemplates = allTemplates.filter(
    (t) => t.active && (t.stores ?? []).some((s: Store) => s.id === storeId),
  );
  const selectedTemplate = availableTemplates.find((t) => t.id === templateId);

  const flaggedResponses = useMemo(() => {
    if (!correctionReport) return [] as ReportResponse[];
    return ((correctionReport.responses ?? []) as ReportResponse[]).filter((r) =>
      ['rejected', 'need_correction'].includes(r.status),
    );
  }, [correctionReport]);

  const visibleItems: TemplateItem[] = useMemo(() => {
    if (!selectedTemplate?.items) return [];
    const items = selectedTemplate.items as TemplateItem[];
    const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    if (correctionMode) {
      const flaggedItemIds = new Set(flaggedResponses.map((r) => r.templateItemId));
      return sorted.filter((i) => flaggedItemIds.has(i.id));
    }

    if (seesAllTemplateItems(profile.role, defs)) return sorted;
    return sorted.filter((i) => i.assignedRole === profile.role);
  }, [selectedTemplate, profile.role, correctionMode, flaggedResponses, defs]);

  useEffect(() => {
    if (!correctionMode || !correctionReport || correctionInitRef.current) return;
    if (correctionReport.submittedByUserId !== profile.userId) return;

    correctionInitRef.current = true;

    const flagged = ((correctionReport.responses ?? []) as ReportResponse[]).filter((r) =>
      ['rejected', 'need_correction'].includes(r.status),
    );

    const initialResponses: Record<string, LocalResponse> = {};
    const idMap: Record<string, string> = {};
    const notes: Record<string, string> = {};
    const mediaIds = new Set<string>();

    for (const resp of flagged) {
      idMap[resp.templateItemId] = resp.id;
      notes[resp.templateItemId] = resp.rejectionReason ?? '';
      const media = (resp.media ?? []) as MediaRecord[];
      for (const m of media) mediaIds.add(m.id);

      initialResponses[resp.templateItemId] = {
        ticked: false,
        numberValue: resp.numberValue ?? '',
        note: resp.note ?? '',
        mediaItems: media.map(
          (m): UploadedMedia => ({
            mediaRecordId: m.id,
            fileId: m.file?.id ?? '',
            url: m.fileUrl || m.file?.url || '',
            fileName: m.fileName,
            photoCode: m.photoCode,
            capturedAt: m.capturedAt,
            mimeType: m.mimeType,
          }),
        ),
      };
    }

    setStoreId(correctionReport.storeId);
    setTemplateId(correctionReport.templateId);
    setReportDate(correctionReport.reportDate);
    setResponses(initialResponses);
    setResponseIdByItem(idMap);
    setCorrectionNotes(notes);
    setExistingMediaIds(mediaIds);
    setStep(0);
    setCorrectionReady(true);
  }, [correctionMode, correctionReport, profile.userId]);

  const currentItem = visibleItems[step];
  const progress = visibleItems.length ? ((step + 1) / visibleItems.length) * 100 : 0;
  const inChecklistFlow =
    correctionMode
      ? correctionReady && visibleItems.length > 0 && !submitted
      : !!(storeId && templateId && !submitted);

  useEffect(() => {
    if (inChecklistFlow) document.body.classList.add('wizard-active');
    else document.body.classList.remove('wizard-active');
    return () => document.body.classList.remove('wizard-active');
  }, [inChecklistFlow]);

  function blockIfCameraReviewPending(): boolean {
    if (cameraReviewPending) {
      alert(t.submit.confirmCaptureFirst);
      return true;
    }
    return false;
  }

  function goWizardBack(): boolean {
    if (submitted) {
      if (correctionMode) {
        onCorrectionComplete?.();
        return true;
      }
      // Let AppShell page back navigate home
      return false;
    }

    if (blockIfCameraReviewPending()) return true;

    // Final review/submit screen (step past last item)
    if (!currentItem && visibleItems.length > 0) {
      setStep(visibleItems.length - 1);
      return true;
    }

    if (!inChecklistFlow) return false;

    if (step === 0) {
      if (correctionMode) {
        onCorrectionComplete?.();
        return true;
      }
      setTemplateId('');
      setStep(0);
      return true;
    }

    setStep((s) => s - 1);
    return true;
  }

  useNativeBack(goWizardBack, inChecklistFlow || submitted, BACK_PRIORITY.WIZARD);

  function setResponse(itemId: string, patch: Partial<LocalResponse>) {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? EMPTY_RESPONSE), ...patch },
    }));
  }

  function addMedia(itemId: string, media: UploadedMedia) {
    setResponses((prev) => {
      const existing = prev[itemId] ?? EMPTY_RESPONSE;
      return {
        ...prev,
        [itemId]: {
          ...existing,
          mediaItems: [...existing.mediaItems, media],
          ticked: true,
        },
      };
    });
  }

  function validateItems(items: TemplateItem[]): boolean {
    for (const item of items) {
      const r = responses[item.id] ?? EMPTY_RESPONSE;
      if (item.required && !r.ticked) {
        alert(`${t.submit.markItemDoneNamed} ${item.title}`);
        return false;
      }
      if (correctionMode && needsMedia(item.proofType)) {
        const hasNewPhoto = r.mediaItems.some((m) => !existingMediaIds.has(m.mediaRecordId));
        if (!hasNewPhoto) {
          alert(`${t.submit.newPhotoRequired} ${item.title}`);
          return false;
        }
      } else if (item.required && needsMedia(item.proofType) && !r.mediaItems.length) {
        alert(`${t.validation.missingPhoto} ${item.title}`);
        return false;
      }
      if (item.required && needsNote(item.proofType) && !r.note.trim()) {
        alert(`${t.validation.missingNote} ${item.title}`);
        return false;
      }
      if (item.required && needsNumber(item.proofType) && !r.numberValue.trim()) {
        alert(`${t.validation.missingNumber} ${item.title}`);
        return false;
      }
    }
    return true;
  }

  async function submitReport() {
    if (!selectedStore || !selectedTemplate) return alert(t.submit.selectStoreTemplateFirst);
    if (!validateItems(visibleItems)) return;

    setSubmitting(true);
    try {
      const now = nowIso();

      const responseItems = visibleItems.map((item) => {
        const r = responses[item.id] ?? EMPTY_RESPONSE;
        return {
          id: id(),
          templateItemId: item.id,
          section: item.section,
          title: item.title,
          proofType: item.proofType,
          required: item.required,
          assignedRole: item.assignedRole,
          approverRolesJson: item.approverRolesJson,
          weight: item.weight,
          failureCategory: item.failureCategory,
          ticked: r.ticked,
          numberValue: r.numberValue,
          note: r.note,
          status: r.ticked ? 'waiting_approval' : 'not_started',
          rejectionReason: '',
          feedbackCode: '',
          feedbackNote: '',
          submittedByUserId: profile.userId,
          submittedByRole: profile.role,
          submittedAt: now,
          approvedByUserId: '',
          approvedAt: '',
          updatedAt: now,
          mediaItems: r.mediaItems,
        };
      });

      const completionPercent = calcCompletion(
        responseItems.map((r) => ({ ticked: r.ticked, required: r.required })),
      );

      const reportTx = db.tx.reports[activeReportId]
        .update({
          storeId: selectedStore.id,
          storeCode: selectedStore.code,
          storeName: selectedStore.name,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          reportType: selectedTemplate.reportType,
          reportDate,
          submittedByUserId: profile.userId,
          submittedByRole: profile.role,
          submittedAt: now,
          status: 'waiting_approval',
          completionPercent,
          compliancePercent: 0,
          archived: false,
          archiveMonth: '',
          createdAt: now,
          updatedAt: now,
        })
        .link({ store: selectedStore.id, template: selectedTemplate.id, submitter: profile.id });

      const responseTxs = responseItems.map((resp) =>
        db.tx.reportResponses[resp.id]
          .update({
            reportId: activeReportId,
            templateItemId: resp.templateItemId,
            section: resp.section,
            title: resp.title,
            proofType: resp.proofType,
            required: resp.required,
            assignedRole: resp.assignedRole,
            approverRolesJson: resp.approverRolesJson,
            weight: resp.weight,
            failureCategory: resp.failureCategory,
            ticked: resp.ticked,
            numberValue: resp.numberValue,
            note: resp.note,
            status: resp.status,
            rejectionReason: '',
            feedbackCode: '',
            feedbackNote: '',
            submittedByUserId: profile.userId,
            submittedByRole: profile.role,
            submittedAt: now,
            approvedByUserId: '',
            approvedAt: '',
            updatedAt: now,
          })
          .link({ report: activeReportId }),
      );

      const mediaLinkTxs = responseItems.flatMap((resp) =>
        resp.mediaItems.map((m: UploadedMedia) =>
          db.tx.mediaRecords[m.mediaRecordId].link({ reportResponse: resp.id }),
        ),
      );

      const reviewEventTxs = buildReportSubmittedEvents(
        activeReportId,
        selectedStore.id,
        profile,
        responseItems.map((r) => ({ id: r.id, title: r.title, status: r.status })),
        now,
      );

      await db.transact([reportTx, ...responseTxs, ...mediaLinkTxs, ...reviewEventTxs]);
      setSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.submit.submissionFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function resubmitCorrections() {
    if (!correctionReport || !selectedStore) return;
    if (!validateItems(visibleItems)) return;

    setSubmitting(true);
    try {
      const now = nowIso();
      const allResponses = (correctionReport.responses ?? []) as ReportResponse[];

      const responseUpdateTxs = visibleItems.map((item) => {
        const respId = responseIdByItem[item.id];
        const r = responses[item.id] ?? EMPTY_RESPONSE;
        return db.tx.reportResponses[respId].update({
          ticked: r.ticked,
          numberValue: r.numberValue,
          note: r.note,
          status: 'waiting_approval',
          rejectionReason: '',
          feedbackCode: '',
          feedbackNote: '',
          submittedAt: now,
          updatedAt: now,
          approvedByUserId: '',
          approvedAt: '',
        });
      });

      const mediaLinkTxs = visibleItems.flatMap((item) => {
        const respId = responseIdByItem[item.id];
        const r = responses[item.id] ?? EMPTY_RESPONSE;
        return r.mediaItems
          .filter((m) => !existingMediaIds.has(m.mediaRecordId))
          .map((m) => db.tx.mediaRecords[m.mediaRecordId].link({ reportResponse: respId }));
      });

      const mergedResponses = allResponses.map((resp) => {
        const item = visibleItems.find((i) => responseIdByItem[i.id] === resp.id);
        if (!item) return resp;
        const r = responses[item.id] ?? EMPTY_RESPONSE;
        return { ...resp, ticked: r.ticked, status: 'waiting_approval' as const };
      });

      const completionPercent = calcCompletion(
        mergedResponses.map((r) => ({ ticked: r.ticked, required: r.required })),
      );

      const reportTx = db.tx.reports[correctionReport.id].update({
        status: 'waiting_approval',
        completionPercent,
        updatedAt: now,
      });

      const resubmittedItems = visibleItems.map((item) => ({
        id: responseIdByItem[item.id]!,
        title: item.title,
      }));
      const reviewEventTxs = buildItemResubmittedEvents(
        correctionReport.id,
        correctionReport.storeId,
        profile,
        resubmittedItems,
        now,
      );

      await db.transact([reportTx, ...responseUpdateTxs, ...mediaLinkTxs, ...reviewEventTxs]);
      setSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.validation.resubmitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    if (correctionMode) {
      onCorrectionComplete?.();
      return;
    }
    window.location.reload();
  }

  if (correctionMode && correctionReport && correctionReport.submittedByUserId !== profile.userId) {
    return (
      <div className="card">
        <h2>{t.submit.notYourReport}</h2>
        <p>{t.submit.onlyYourReports}</p>
        <button className="secondary" onClick={() => onCorrectionComplete?.()}>
          {t.submit.backToHome}
        </button>
      </div>
    );
  }

  if (correctionMode && correctionReport && !flaggedResponses.length) {
    return (
      <div className="card">
        <h2>{t.submit.noCorrections}</h2>
        <p>{t.submit.noItemsWaiting}</p>
        <button className="secondary" onClick={() => onCorrectionComplete?.()}>
          {t.submit.backToHome}
        </button>
      </div>
    );
  }

  if (correctionMode && !correctionReady) {
    return (
      <div className="card">
        <p>{t.submit.loadingCorrections}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="card">
        <h2>{correctionMode ? t.submit.correctionsResubmitted : t.submit.reportSubmitted}</h2>
        <p>
          {correctionMode ? t.submit.fixesInQueue : t.submit.waitingReview}
        </p>
        <button onClick={resetForm}>
          {correctionMode ? t.submit.backToHome : t.submit.submitAnother}
        </button>
      </div>
    );
  }

  if (!correctionMode && (!storeId || !templateId)) {
    return (
      <div>
        <div className="card">
          <h1>{t.submit.title}</h1>
          <p className="small">{t.submit.watermarkHint}</p>
        </div>
        <div className="card">
          <div className="grid two">
            <label>
              {t.common.date}
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </label>
            <label>
              {t.common.store}
              <select
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setTemplateId('');
                }}
              >
                <option value="">{t.common.selectStore}</option>
                {accessibleStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.submit.checklistTemplate}
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={!storeId}
              >
                <option value="">{t.common.selectTemplate}</option>
                {availableTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="submit-wizard">
        <div className="card">
          <h2>{correctionMode ? t.submit.readyToResubmit : t.submit.readyToSubmit}</h2>
          <p>
            {correctionMode
              ? `${visibleItems.length} ${
                  visibleItems.length > 1 ? t.submit.correctedItemsReady : t.submit.correctedItemReady
                }`
              : `${visibleItems.length} ${t.submit.itemsCompleted}`}
          </p>
        </div>
        <WizardNav
          t={t}
          step={visibleItems.length}
          total={visibleItems.length}
          progress={100}
          backLabel={`← ${t.common.back}`}
          nextLabel={
            submitting
              ? t.submit.submitting
              : correctionMode
                ? t.submit.resubmitCorrectionsCheck
                : t.submit.submitReportCheck
          }
          onBack={() => {
            goWizardBack();
          }}
          onNext={correctionMode ? resubmitCorrections : submitReport}
          nextDisabled={submitting}
        />
      </div>
    );
  }

  const r = responses[currentItem.id] ?? EMPTY_RESPONSE;
  const itemFeedback = correctionNotes[currentItem.id];
  const responseRecordId = responseIdByItem[currentItem.id] ?? currentItem.id;

  return (
    <div className="submit-wizard">
      {correctionMode && (
        <div className="card correction-mode-banner">
          <h2 style={{ margin: 0 }}>{t.submit.fixCorrections}</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>
            {selectedStore?.code} — {correctionReport?.templateName} · {correctionReport?.reportDate}
          </p>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 10 }}
            onClick={() => onCorrectionComplete?.()}
          >
            {t.common.cancel}
          </button>
        </div>
      )}

      <div className="card">
        <p className="small">
          {t.submit.itemNOf} {step + 1} {t.common.of} {visibleItems.length}
          {correctionMode ? ` · ${t.submit.correctionTag}` : ''}
        </p>
        <div className="progress-bar">
          <div style={{ width: progress + '%' }} />
        </div>
        <h2>{currentItem.title}</h2>
        <p>{currentItem.requirement}</p>
        <p className="small">
          {currentItem.section} · {currentItem.proofType} ·{' '}
          {currentItem.required ? t.common.required : t.common.optional}
        </p>
      </div>

      {itemFeedback && (
        <div className="card correction-feedback-card">
          <div className="correction-feedback-label">{t.submit.reviewerFeedback}</div>
          <p className="correction-feedback-text">{itemFeedback}</p>
          <p className="small">{t.submit.updateAndPhoto}</p>
        </div>
      )}

      <div className="card">
        <button
          type="button"
          className={`done-toggle${r.ticked ? ' done-toggle--on' : ''}`}
          onClick={() => setResponse(currentItem.id, { ticked: !r.ticked })}
          aria-pressed={r.ticked}
        >
          <span className="done-toggle-icon" aria-hidden="true">
            {r.ticked ? '✓' : ''}
          </span>
          <span>{t.submit.doneCompleted}</span>
        </button>

        {needsNumber(currentItem.proofType) && (
          <label style={{ marginTop: 12, display: 'block' }}>
            {t.common.number}
            <input
              value={r.numberValue}
              onChange={(e) => setResponse(currentItem.id, { numberValue: e.target.value })}
            />
          </label>
        )}

        {needsNote(currentItem.proofType) && (
          <label style={{ marginTop: 12, display: 'block' }}>
            {t.common.note}
            <textarea
              value={r.note}
              onChange={(e) => setResponse(currentItem.id, { note: e.target.value })}
            />
          </label>
        )}

        {needsMedia(currentItem.proofType) && selectedStore && (
          <div style={{ marginTop: 12 }}>
            <TimemarkCamera
              key={currentItem.id}
              store={selectedStore}
              itemTitle={currentItem.title}
              reportDate={reportDate}
              reportId={activeReportId}
              reportResponseId={responseRecordId}
              profile={profile}
              proofType={currentItem.proofType}
              existingMedia={r.mediaItems}
              onCapture={(media) => addMedia(currentItem.id, media)}
              onReviewPendingChange={setCameraReviewPending}
            />
          </div>
        )}
      </div>

      <WizardNav
        t={t}
        step={step}
        total={visibleItems.length}
        progress={progress}
        backLabel={`← ${t.common.back}`}
        nextLabel={
          step + 1 >= visibleItems.length
            ? correctionMode
              ? t.submit.reviewResubmit
              : t.submit.reviewSubmit
            : t.submit.nextItem
        }
        onBack={() => {
          goWizardBack();
        }}
        onNext={() => {
          if (blockIfCameraReviewPending()) return;
          if (currentItem.required && !r.ticked) return alert(t.submit.markDoneFirst);
          if (step + 1 >= visibleItems.length) setStep(visibleItems.length);
          else setStep((s) => s + 1);
        }}
      />
    </div>
  );
}

import type { T } from '../i18n';

interface WizardNavProps {
  t: T;
  step: number;
  total: number;
  progress: number;
  backLabel: string;
  nextLabel: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

function WizardNav({
  t,
  step,
  total,
  progress,
  backLabel,
  nextLabel,
  onBack,
  onNext,
  nextDisabled,
}: WizardNavProps) {
  const displayStep = Math.min(step + 1, total);

  return (
    <div className="wizard-nav" role="navigation" aria-label={t.submit.wizardNav}>
      <div className="wizard-nav-meta">
        <span className="wizard-nav-step">
          {t.common.step} {displayStep} / {total}
        </span>
        <span className="wizard-nav-pct">{Math.round(progress)}%</span>
      </div>
      <div className="wizard-nav-track" aria-hidden="true">
        <div className="wizard-nav-track-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="wizard-nav-actions">
        <button type="button" className="wizard-btn wizard-btn-back" onClick={onBack}>
          {backLabel}
        </button>
        <button
          type="button"
          className="wizard-btn wizard-btn-next"
          onClick={onNext}
          disabled={nextDisabled}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
