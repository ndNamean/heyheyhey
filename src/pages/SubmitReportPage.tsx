import { useMemo, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { needsMedia, needsNote, needsNumber, userCanAccessStore } from '../lib/roles';
import { calcCompletion, nowIso, todayYmd } from '../lib/utils';
import TimemarkCamera from '../components/TimemarkCamera';
import type { LocalResponse, Profile, Store, Template, TemplateItem, UploadedMedia } from '../types';

interface Props {
  profile: Profile;
}

export default function SubmitReportPage({ profile }: Props) {
  // Pre-generate a stable reportId so photo paths are valid before submission
  const [reportId] = useState(() => id());
  const [storeId, setStoreId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [reportDate, setReportDate] = useState(todayYmd);
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, LocalResponse>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { data } = db.useQuery({
    stores: {},
    templates: { items: {}, stores: {} },
  });

  const allStores: Store[] = (data?.stores ?? []) as Store[];
  const allTemplates: Template[] = (data?.templates ?? []) as Template[];

  // Filter stores to those the user can access
  const accessibleStores = allStores.filter(
    (s) => s.active && userCanAccessStore(profile.role, (profile.stores ?? []).map((st) => st.id), s.id),
  );

  const selectedStore = accessibleStores.find((s) => s.id === storeId);
  const availableTemplates = allTemplates.filter(
    (t) => t.active && (t.stores ?? []).some((s: Store) => s.id === storeId),
  );
  const selectedTemplate = availableTemplates.find((t) => t.id === templateId);

  const visibleItems: TemplateItem[] = useMemo(() => {
    if (!selectedTemplate?.items) return [];
    const items = selectedTemplate.items as TemplateItem[];
    const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (profile.role === 'owner' || profile.role === 'areaManager') return sorted;
    return sorted.filter((i) => i.assignedRole === profile.role);
  }, [selectedTemplate, profile.role]);

  const currentItem = visibleItems[step];
  const progress = visibleItems.length ? ((step + 1) / visibleItems.length) * 100 : 0;

  function setResponse(itemId: string, patch: Partial<LocalResponse>) {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { ticked: false, numberValue: '', note: '', mediaItems: [] }), ...patch },
    }));
  }

  function addMedia(itemId: string, media: UploadedMedia) {
    setResponses((prev) => {
      const existing = prev[itemId] ?? { ticked: false, numberValue: '', note: '', mediaItems: [] };
      return {
        ...prev,
        [itemId]: {
          ...existing,
          mediaItems: [...existing.mediaItems, media],
          ticked: true, // auto-tick when a photo is added
        },
      };
    });
  }

  async function submitReport() {
    if (!selectedStore || !selectedTemplate) return alert('Select a store and template first');

    // Validate
    for (const item of visibleItems) {
      const r = responses[item.id] ?? { ticked: false, numberValue: '', note: '', mediaItems: [] };
      if (item.required && !r.ticked)
        return alert(`Mark item as done: ${item.title}`);
      if (item.required && needsMedia(item.proofType) && !r.mediaItems.length)
        return alert(`Missing photo/video: ${item.title}`);
      if (item.required && needsNote(item.proofType) && !r.note.trim())
        return alert(`Missing note: ${item.title}`);
      if (item.required && needsNumber(item.proofType) && !r.numberValue.trim())
        return alert(`Missing number: ${item.title}`);
    }

    setSubmitting(true);
    try {
        const now = nowIso();

      // Build response rows
      const responseItems = visibleItems.map((item) => {
        const r = responses[item.id] ?? { ticked: false, numberValue: '', note: '', mediaItems: [] };
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

      // Create report
      const reportTx = db.tx.reports[reportId]
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

      // Create response records
      const responseTxs = responseItems.map((resp) => {
        const txBase = db.tx.reportResponses[resp.id]
          .update({
            reportId,
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
          .link({ report: reportId });

        return txBase;
      });

      // Link media records to their response IDs
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

  function resetForm() {
    // Navigate away to force a fresh reportId on re-mount
    window.location.reload();
  }

  // ── Submitted confirmation ────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="card">
        <h2>Report submitted</h2>
        <p>Your report is now waiting for review.</p>
        <button onClick={resetForm}>Submit another report</button>
      </div>
    );
  }

  // ── Store / template selection ────────────────────────────────────────────
  if (!storeId || !templateId) {
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
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
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

  // ── Review & submit screen ────────────────────────────────────────────────
  if (!currentItem) {
    return (
      <div className="card">
        <h2>Ready to submit</h2>
        <p>{visibleItems.length} items completed.</p>
        <button onClick={submitReport} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit report'}
        </button>
        <button
          className="secondary"
          style={{ marginTop: 8 }}
          onClick={() => setStep(visibleItems.length - 1)}
        >
          Back
        </button>
      </div>
    );
  }

  // ── Item wizard ───────────────────────────────────────────────────────────
  const r = responses[currentItem.id] ?? { ticked: false, numberValue: '', note: '', mediaItems: [] };

  return (
    <div>
      <div className="card">
        <p className="small">
          Item {step + 1} of {visibleItems.length}
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

      <div className="card">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={r.ticked}
            onChange={(e) => setResponse(currentItem.id, { ticked: e.target.checked })}
            style={{ width: 24, height: 24 }}
          />
          Done / Completed
        </label>

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
              reportId={reportId}
              reportResponseId={currentItem.id}   // template item id — used as folder key
              profile={profile}
              existingMedia={r.mediaItems}
              onCapture={(media) => addMedia(currentItem.id, media)}
            />
          </div>
        )}
      </div>

      <div className="sticky-footer">
        <div className="grid two">
          <button
            className="secondary"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
          <button
            onClick={() => {
              if (currentItem.required && !r.ticked) return alert('Mark item as done first');
              if (step + 1 >= visibleItems.length) setStep(visibleItems.length);
              else setStep((s) => s + 1);
            }}
          >
            {step + 1 >= visibleItems.length ? 'Review & submit' : 'Next item'}
          </button>
        </div>
      </div>
    </div>
  );
}
