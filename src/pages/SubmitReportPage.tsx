import { useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { needsMedia, needsNote, needsNumber, userCanAccessStore } from '../lib/roles';
import { calcCompletion, nowIso, todayYmd } from '../lib/utils';
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
    (s) => s.active && userCanAccessStore(profile.role, (profile.stores ?? []).map((st) => st.id), s.id),
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

    if (profile.role === 'owner' || profile.role === 'areaManager') return sorted;
    return sorted.filter((i) => i.assignedRole === profile.role);
  }, [selectedTemplate, profile.role, correctionMode, flaggedResponses]);

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
        alert(`Mark item as done: ${item.title}`);
        return false;
      }
      if (correctionMode && needsMedia(item.proofType)) {
        const hasNewPhoto = r.mediaItems.some((m) => !existingMediaIds.has(m.mediaRecordId));
        if (!hasNewPhoto) {
          alert(`Please take a new photo: ${item.title}`);
          return false;
        }
      } else if (item.required && needsMedia(item.proofType) && !r.mediaItems.length) {
        alert(`Missing photo/video: ${item.title}`);
        return false;
      }
      if (item.required && needsNote(item.proofType) && !r.note.trim()) {
        alert(`Missing note: ${item.title}`);
        return false;
      }
      if (item.required && needsNumber(item.proofType) && !r.numberValue.trim()) {
        alert(`Missing number: ${item.title}`);
        return false;
      }
    }
    return true;
  }

  async function submitReport() {
    if (!selectedStore || !selectedTemplate) return alert('Select a store and template first');
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

      await db.transact([reportTx, ...responseTxs, ...mediaLinkTxs]);
      setSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Submission failed');
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

      await db.transact([reportTx, ...responseUpdateTxs, ...mediaLinkTxs]);
      setSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Resubmission failed');
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
        <h2>Not your report</h2>
        <p>You can only fix reports you submitted.</p>
        <button className="secondary" onClick={() => onCorrectionComplete?.()}>
          Back to home
        </button>
      </div>
    );
  }

  if (correctionMode && correctionReport && !flaggedResponses.length) {
    return (
      <div className="card">
        <h2>No corrections needed</h2>
        <p>This report has no items waiting for correction.</p>
        <button className="secondary" onClick={() => onCorrectionComplete?.()}>
          Back to home
        </button>
      </div>
    );
  }

  if (correctionMode && !correctionReady) {
    return (
      <div className="card">
        <p>Loading corrections…</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="card">
        <h2>{correctionMode ? 'Corrections resubmitted' : 'Report submitted'}</h2>
        <p>
          {correctionMode
            ? 'Your fixes are back in the review queue.'
            : 'Your report is now waiting for review.'}
        </p>
        <button onClick={resetForm}>{correctionMode ? 'Back to home' : 'Submit another report'}</button>
      </div>
    );
  }

  if (!correctionMode && (!storeId || !templateId)) {
    return (
      <div>
        <div className="card">
          <h1>Submit Report</h1>
          <p className="small">Photos are watermarked with store, GPS, date/time, and your name.</p>
        </div>
        <div className="card">
          <div className="grid two">
            <label>
              Date
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </label>
            <label>
              Store
              <select
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setTemplateId('');
                }}
              >
                <option value="">Select store</option>
                {accessibleStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Checklist template
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={!storeId}
              >
                <option value="">Select template</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
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
          <h2>{correctionMode ? 'Ready to resubmit' : 'Ready to submit'}</h2>
          <p>
            {correctionMode
              ? `${visibleItems.length} corrected item${visibleItems.length > 1 ? 's' : ''} ready for review.`
              : `${visibleItems.length} items completed.`}
          </p>
        </div>
        <WizardNav
          step={visibleItems.length}
          total={visibleItems.length}
          progress={100}
          backLabel="← Back"
          nextLabel={
            submitting
              ? 'Submitting…'
              : correctionMode
                ? 'Resubmit corrections ✓'
                : 'Submit report ✓'
          }
          onBack={() => setStep(visibleItems.length - 1)}
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
          <h2 style={{ margin: 0 }}>Fix corrections</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>
            {selectedStore?.code} — {correctionReport?.templateName} · {correctionReport?.reportDate}
          </p>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 10 }}
            onClick={() => onCorrectionComplete?.()}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="card">
        <p className="small">
          Item {step + 1} of {visibleItems.length}
          {correctionMode ? ' · correction' : ''}
        </p>
        <div className="progress-bar">
          <div style={{ width: progress + '%' }} />
        </div>
        <h2>{currentItem.title}</h2>
        <p>{currentItem.requirement}</p>
        <p className="small">
          {currentItem.section} · {currentItem.proofType} ·{' '}
          {currentItem.required ? 'Required' : 'Optional'}
        </p>
      </div>

      {itemFeedback && (
        <div className="card correction-feedback-card">
          <div className="correction-feedback-label">Reviewer feedback</div>
          <p className="correction-feedback-text">{itemFeedback}</p>
          <p className="small">Update your answer below, then mark done and take a new photo if needed.</p>
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
          <span>Done / Completed</span>
        </button>

        {needsNumber(currentItem.proofType) && (
          <label style={{ marginTop: 12, display: 'block' }}>
            Number
            <input
              value={r.numberValue}
              onChange={(e) => setResponse(currentItem.id, { numberValue: e.target.value })}
            />
          </label>
        )}

        {needsNote(currentItem.proofType) && (
          <label style={{ marginTop: 12, display: 'block' }}>
            Note
            <textarea
              value={r.note}
              onChange={(e) => setResponse(currentItem.id, { note: e.target.value })}
            />
          </label>
        )}

        {needsMedia(currentItem.proofType) && selectedStore && (
          <div style={{ marginTop: 12 }}>
            <TimemarkCamera
              store={selectedStore}
              itemTitle={currentItem.title}
              reportDate={reportDate}
              reportId={activeReportId}
              reportResponseId={responseRecordId}
              profile={profile}
              existingMedia={r.mediaItems}
              onCapture={(media) => addMedia(currentItem.id, media)}
            />
          </div>
        )}
      </div>

      <WizardNav
        step={step}
        total={visibleItems.length}
        progress={progress}
        backLabel="← Back"
        nextLabel={
          step + 1 >= visibleItems.length
            ? correctionMode
              ? 'Review & resubmit →'
              : 'Review & submit →'
            : 'Next item →'
        }
        onBack={() => {
          if (step === 0) {
            if (correctionMode) {
              onCorrectionComplete?.();
            } else {
              setTemplateId('');
              setStep(0);
            }
          } else {
            setStep((s) => s - 1);
          }
        }}
        onNext={() => {
          if (currentItem.required && !r.ticked) return alert('Mark item as done first');
          if (step + 1 >= visibleItems.length) setStep(visibleItems.length);
          else setStep((s) => s + 1);
        }}
      />
    </div>
  );
}

interface WizardNavProps {
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
    <div className="wizard-nav" role="navigation" aria-label="Checklist steps">
      <div className="wizard-nav-meta">
        <span className="wizard-nav-step">
          Step {displayStep} / {total}
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
