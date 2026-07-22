import { useMemo, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canApproveItem, canReview } from '../lib/roles';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildItemReviewNotifications,
  buildLogbookResolutionDecisionNotifications,
  buildReportFinalizedNotifications,
} from '../lib/notifications';
import {
  buildItemReviewEvent,
  buildLogbookResolutionApprovedEvent,
  buildLogbookResolutionRejectedEvent,
  buildReportFinalizedEvent,
} from '../lib/reviewEvents';
import { resolveActorDisplay } from '../lib/actorDisplay';
import { badgeClass, nowIso } from '../lib/utils';
import ProofPhoto from '../components/ProofPhoto';
import ProofMediaDetails from '../components/ProofMediaDetails';
import ReviewFeedbackModal, { type FeedbackResult } from '../components/ReviewFeedbackModal';
import { isVideoMedia } from '../lib/mediaMime';
import { formatMediaCaptureTime } from '../lib/proofTime';
import ReportTimeline, { LogbookTimeline } from '../components/ReportTimeline';
import {
  canReviewLogbookIssue,
  getIssueConfigurationState,
  isIssueOverdue,
  isLogbookIssue,
  resolveLogbookIssueStatus,
  resolveResolutionMedia,
  resolveSourceMedia,
} from '../lib/logbook';
import {
  proofTypeLabel,
  resolveLogbookProofType,
} from '../lib/logbookResolution';
import type {
  LogbookEntry,
  MediaRecord,
  Profile,
  Report,
  ReportResponse,
  ReviewEvent,
} from '../types';

interface Props {
  profile: Profile;
}

interface PendingFeedback {
  report: Report;
  response: ReportResponse;
  status: 'rejected' | 'need_correction';
}

type ReviewSurface = 'reports' | 'logbook';

export default function ReviewPage({ profile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);
  const [surface, setSurface] = useState<ReviewSurface>('reports');

  const { data } = db.useQuery({
    reports: {
      $: { where: { status: 'waiting_approval' } },
      responses: { media: { file: {} } },
      store: {},
    },
    logbookEntries: { store: {}, photo: {}, sourceMedia: {}, resolutionMedia: {} },
    profiles: { stores: {} },
    reviewEvents: {},
  });

  const reports: Report[] = (data?.reports ?? []) as Report[];
  const allProfiles: Profile[] = (data?.profiles ?? []) as Profile[];
  const allEvents = (data?.reviewEvents ?? []) as ReviewEvent[];
  const logbookIssues = useMemo(() => {
    return ((data?.logbookEntries ?? []) as LogbookEntry[]).filter(
      (e) =>
        isLogbookIssue(e) &&
        resolveLogbookIssueStatus(e) === 'waiting_approval' &&
        canReviewLogbookIssue(profile, e, defs),
    );
  }, [data?.logbookEntries, profile, defs]);

  if (!canReview(profile.role, defs)) {
    return <div className="card">{t.review.noPermission}</div>;
  }

  async function approveLogbookIssue(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.reviewNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'resolved',
        resolvedAt: now,
        resolvedByUserId: entry.resolutionSubmittedByUserId || '',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionApprovedEvent(entry, profile, note.trim()),
      ...buildLogbookResolutionDecisionNotifications(
        { ...entry, reviewNote: note.trim() },
        profile,
        allProfiles,
        'approved',
        defs,
      ),
    ]);
  }

  async function requestLogbookCorrection(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.correctionNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'in_progress',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionRejectedEvent(entry, profile, note.trim()),
      ...buildLogbookResolutionDecisionNotifications(
        { ...entry, reviewNote: note.trim() },
        profile,
        allProfiles,
        'rejected',
        defs,
      ),
    ]);
  }

  function openFeedbackModal(
    report: Report,
    response: ReportResponse,
    status: 'rejected' | 'need_correction',
  ) {
    const approverRoles = JSON.parse(response.approverRolesJson || '[]') as import('../types').Role[];
    if (
      !canApproveItem(
        response.submittedByRole as import('../types').Role,
        profile.role,
        approverRoles,
        defs,
      )
    ) {
      alert(t.review.noPermissionItem);
      return;
    }
    setPendingFeedback({ report, response, status });
  }

  async function updateResponseStatus(
    report: Report,
    response: ReportResponse,
    status: 'approved' | 'rejected' | 'need_correction',
    feedback?: FeedbackResult,
  ) {
    const approverRoles = JSON.parse(response.approverRolesJson || '[]') as import('../types').Role[];
    if (
      !canApproveItem(
        response.submittedByRole as import('../types').Role,
        profile.role,
        approverRoles,
        defs,
      )
    ) {
      alert(t.review.noPermissionItem);
      return;
    }

    const reason = feedback?.rejectionReason ?? '';

    const now = nowIso();
    const responses = (report.responses ?? []) as ReportResponse[];
    const notificationTxs = buildItemReviewNotifications(
      report,
      response,
      status,
      reason,
      profile,
      allProfiles,
      responses,
    );

    await db.transact([
      db.tx.reportResponses[response.id].update({
        status,
        rejectionReason: reason,
        feedbackCode: feedback?.feedbackCode ?? '',
        feedbackNote: feedback?.feedbackNote ?? '',
        approvedByUserId: profile.userId,
        approvedAt: now,
        updatedAt: now,
      }),
      buildItemReviewEvent(report, response, status, reason, profile, now, {
        feedbackCode: feedback?.feedbackCode,
        feedbackNote: feedback?.feedbackNote,
      }),
      ...notificationTxs,
    ]);
  }

  async function handleFeedbackConfirm(result: FeedbackResult) {
    if (!pendingFeedback) return;
    const { report, response, status } = pendingFeedback;
    setPendingFeedback(null);
    await updateResponseStatus(report, response, status, result);
  }

  async function markReportApproved(report: Report) {
    const responses = (report.responses ?? []) as ReportResponse[];
    const allApproved = responses.every((r) => r.status === 'approved');
    const anyRejected = responses.some((r) => r.status === 'rejected');
    const newStatus = allApproved ? 'approved' : anyRejected ? 'rejected' : 'waiting_approval';
    const compliancePercent =
      responses.length
        ? Math.round(
            (responses.filter((r) => r.status === 'approved').length / responses.length) * 100,
          )
        : 0;

    const notificationTxs = buildReportFinalizedNotifications(
      report,
      newStatus,
      compliancePercent,
      profile,
      allProfiles,
      responses,
    );

    await db.transact([
      db.tx.reports[report.id].update({
        status: newStatus,
        compliancePercent,
        updatedAt: nowIso(),
      }),
      buildReportFinalizedEvent(report, newStatus, profile, nowIso()),
      ...notificationTxs,
    ]);
  }

  return (
    <div>
      <ReviewFeedbackModal
        open={!!pendingFeedback}
        mode={pendingFeedback?.status ?? 'rejected'}
        itemTitle={pendingFeedback?.response.title ?? ''}
        onConfirm={handleFeedbackConfirm}
        onCancel={() => setPendingFeedback(null)}
      />

      <div className="card">
        <h1>{t.review.title}</h1>
        <p className="small">{t.review.subtitle}</p>
        <div className="tabs" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={surface === 'reports' ? 'active' : ''}
            onClick={() => setSurface('reports')}
          >
            {t.review.tabReports}
            {reports.length > 0 && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                {reports.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={surface === 'logbook' ? 'active' : ''}
            onClick={() => setSurface('logbook')}
          >
            {t.review.tabLogbook}
            {logbookIssues.length > 0 && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                {logbookIssues.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {surface === 'logbook' &&
        logbookIssues.map((entry) => {
          const proofType = resolveLogbookProofType(entry);
          const overdue = isIssueOverdue(entry);
          const submitter = resolveActorDisplay(
            entry.resolutionSubmittedByUserId || '',
            undefined,
            allProfiles,
          );
          const creator = resolveActorDisplay(entry.authorUserId, undefined, allProfiles);
          const entryEvents = allEvents.filter((e) => e.logbookEntryId === entry.id);
          const sourceMedia = resolveSourceMedia(entry);
          const resolutionMedia = resolveResolutionMedia(entry);
          const configState = getIssueConfigurationState(entry);
          return (
            <div className="card" key={entry.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, flex: 1 }}>{t.logbook.typeIssue}</h2>
                <span className={badgeClass('waiting_approval')}>
                  {statusLabel(t, 'waiting_approval')}
                </span>
                {overdue && <span className="badge bad">{t.logbook.statusOverdue}</span>}
                <span className="badge">{proofTypeLabel(proofType)}</span>
              </div>
              <p style={{ margin: '8px 0 0' }}>{entry.content}</p>
              <p className="small">
                {entry.store?.code || entry.storeId} · {t.common.severity}: {entry.severity} ·{' '}
                {t.logbook.assigneeRole}: {entry.assigneeRole || '—'}
              </p>
              <p className="small">
                {t.review.submittedBy} {creator}
                {entry.dueAt
                  ? ` · ${t.logbook.dueAt}: ${new Date(entry.dueAt).toLocaleString()}`
                  : ` · ${t.logbook.noDeadline}`}
              </p>
              {configState !== 'ready' && (
                <p className="small" style={{ color: 'var(--warn, #b45309)' }}>
                  {configState === 'missing_assignment'
                    ? t.logbook.configMissingAssignment
                    : configState === 'missing_deadline'
                      ? t.logbook.configMissingDeadline
                      : t.logbook.configMissingRequirement}
                </p>
              )}
              {entry.resolutionRequirement?.trim() && (
                <p className="small">
                  <strong>{t.logbook.resolutionRequirement}:</strong> {entry.resolutionRequirement}
                </p>
              )}
              <p className="small">
                {t.logbook.resolvedBySubmitter}: {submitter}
                {entry.resolutionSubmittedAt
                  ? ` · ${new Date(entry.resolutionSubmittedAt).toLocaleString()}`
                  : ''}
                {entry.resolutionAttemptId
                  ? ` · attempt ${entry.resolutionAttemptId.slice(0, 8)}`
                  : ''}
              </p>
              {entry.resolutionChecked && (
                <p className="small">
                  {t.logbook.resolutionTick}: ✓
                </p>
              )}
              {entry.resolutionNumber && (
                <p className="small">
                  <strong>{t.logbook.resolutionNumber}:</strong> {entry.resolutionNumber}
                </p>
              )}
              {entry.resolutionNote && (
                <p>
                  <strong>{t.common.note}:</strong> {entry.resolutionNote}
                </p>
              )}
              {sourceMedia.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">{t.logbook.sourceMedia}</div>
                  {sourceMedia.map((m) => (
                    <ProofPhoto key={m.id} media={{ id: m.id, url: m.url }} />
                  ))}
                </div>
              )}
              {resolutionMedia?.url && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">{t.logbook.resolutionProof}</div>
                  <ProofPhoto media={{ id: resolutionMedia.id, url: resolutionMedia.url }} />
                </div>
              )}
              {entryEvents.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <LogbookTimeline entry={entry} events={entryEvents} />
                </div>
              )}
              <div className="capture-actions" style={{ marginTop: 12 }}>
                <button className="success" type="button" onClick={() => void approveLogbookIssue(entry)}>
                  {t.logbook.approveResolution}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void requestLogbookCorrection(entry)}
                >
                  {t.logbook.requestCorrection}
                </button>
              </div>
            </div>
          );
        })}

      {surface === 'logbook' && !logbookIssues.length && (
        <div className="card">
          <p>{t.review.noLogbookAwaiting}</p>
        </div>
      )}

      {surface === 'reports' &&
        reports.map((report) => {
        const responses = (report.responses ?? []) as ReportResponse[];
        const pendingCount = responses.filter((r) => r.status === 'waiting_approval').length;
        const reportSubmitterName = resolveActorDisplay(
          report.submittedByUserId,
          undefined,
          allProfiles,
        );

        return (
          <div className="card" key={report.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {report.storeCode} — {report.templateName}
                </h2>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  {report.reportDate} · {t.review.submittedBy} {reportSubmitterName}
                  {report.submittedByRole ? ` (${report.submittedByRole})` : ''} ·{' '}
                  <span className={badgeClass(report.status)}>{statusLabel(t, report.status)}</span> ·{' '}
                  {report.completionPercent ?? 0}% {t.review.percentComplete}
                </p>
              </div>
              {pendingCount > 0 && (
                <span className="badge warn">{pendingCount} {t.review.pendingItems}</span>
              )}
            </div>

            <ReportTimeline
              report={report}
              events={allEvents.filter((e) => e.reportId === report.id)}
              defaultExpanded
            />

            {responses.map((resp) => {
              const media = (resp.media ?? []) as MediaRecord[];
              const itemSubmitterName = resolveActorDisplay(
                resp.submittedByUserId || report.submittedByUserId,
                undefined,
                allProfiles,
              );
              return (
                <div className="item-card" key={resp.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{resp.title}</h3>
                    <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                  </div>
                  <p className="small">
                    By {itemSubmitterName} · {resp.section} · {resp.proofType}
                  </p>
                  {resp.note && (
                    <p>
                      <strong>{t.common.note}:</strong> {resp.note}
                    </p>
                  )}
                  {resp.numberValue && (
                    <p>
                      <strong>{t.common.number}:</strong> {resp.numberValue}
                    </p>
                  )}
                  {resp.rejectionReason && resp.status !== 'approved' && (
                    <p className="small text-danger" style={{ whiteSpace: 'pre-wrap' }}>
                      {t.review.rejectionReason}: {resp.rejectionReason}
                    </p>
                  )}
                  {media.length > 0 && (
                    <div className="proof-photo-grid">
                      {media.map((m) => (
                        <div className="proof-photo-card" key={m.id}>
                          <ProofPhoto
                            media={m}
                            reviewContext={{
                              storeCode: report.storeCode,
                              itemTitle: resp.title,
                              watermarked: m.watermarked,
                            }}
                          />
                          {isVideoMedia(m.mimeType, m.fileName) && (
                            <ProofMediaDetails media={m} />
                          )}
                          {!isVideoMedia(m.mimeType, m.fileName) && m.photoCode && !m.storageDeleted && (
                            <div className="proof-photo-meta">
                              <span className="proof-photo-code">{m.photoCode}</span>
                              {m.capturedAt && (
                                <span className="proof-photo-time">{formatMediaCaptureTime(m)}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {resp.status === 'waiting_approval' && (
                    <div className="capture-actions" style={{ marginTop: 12 }}>
                      <button
                        className="success"
                        onClick={() => updateResponseStatus(report, resp, 'approved')}
                      >
                        {t.review.approveItem}
                      </button>
                      <button
                        className="danger"
                        onClick={() => openFeedbackModal(report, resp, 'rejected')}
                      >
                        {t.review.rejectItem}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => openFeedbackModal(report, resp, 'need_correction')}
                      >
                        {t.review.correction}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {pendingCount === 0 && responses.every((r) => ['approved', 'rejected'].includes(r.status)) && (
              <button
                className="success"
                style={{ marginTop: 12 }}
                onClick={() => markReportApproved(report)}
              >
                {t.review.finaliseReport}
              </button>
            )}
          </div>
        );
      })}

      {surface === 'reports' && !reports.length && (
        <div className="card">
          <p>{t.review.noAwaitingReview}</p>
        </div>
      )}
    </div>
  );
}
