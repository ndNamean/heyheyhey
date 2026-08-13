import { useEffect, useMemo, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canAccessAllStores, canReview } from '../lib/roles';
import {
  buildReviewReportsWhere,
  canReviewReportItem,
  filterReportsAwaitingReview,
} from '../lib/reportReview';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildItemReviewNotifications,
  buildReportFinalizedNotifications,
} from '../lib/notifications';
import { schedulePushDeliveryFromTxs } from '../lib/pushDelivery';
import {
  buildItemReviewEvent,
  buildLogbookResolutionApprovedEvent,
  buildLogbookResolutionRejectedEvent,
  buildReportFinalizedEvent,
} from '../lib/reviewEvents';
import { deliverLogbookEvent } from '../lib/logbookNotifyClient';
import { deliverReportEvent } from '../lib/reportNotifyClient';
import { resolveActorDisplay } from '../lib/actorDisplay';
import { badgeClass, nowIso } from '../lib/utils';
import ProofPhoto from '../components/ProofPhoto';
import ProofMediaDetails from '../components/ProofMediaDetails';
import ReviewFeedbackModal, { type FeedbackResult } from '../components/ReviewFeedbackModal';
import { isVideoMedia } from '../lib/mediaMime';
import { formatMediaCaptureTime } from '../lib/proofTime';
import ReportTimeline, { LogbookTimeline } from '../components/ReportTimeline';
import IdentityWithAvatar from '../components/profileAvatar/IdentityWithAvatar';
import {
  canReviewLogbookIssue,
  getIssueConfigurationState,
  isIssueOverdue,
  isLogbookIssue,
  resolveLogbookIssueStatus,
  resolveResolutionProofs,
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
  /** Deep-link: force Reports surface and highlight a report card. */
  highlightReportId?: string | null;
  highlightOpenKey?: number;
  initialSurface?: 'reports' | 'logbook';
}

interface PendingFeedback {
  report: Report;
  response: ReportResponse;
  status: 'rejected' | 'need_correction';
}

type ReviewSurface = 'reports' | 'logbook';

export default function ReviewPage({
  profile,
  highlightReportId = null,
  highlightOpenKey = 0,
  initialSurface = 'reports',
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);
  const [surface, setSurface] = useState<ReviewSurface>(initialSurface);

  useEffect(() => {
    if (highlightReportId) {
      setSurface('reports');
    } else if (initialSurface) {
      setSurface(initialSurface);
    }
  }, [highlightReportId, highlightOpenKey, initialSurface]);

  const storeIds = useMemo(
    () => (profile.stores ?? []).map((s) => s.id).filter(Boolean),
    [profile.stores],
  );
  const reportsWhere = useMemo(
    () =>
      buildReviewReportsWhere({
        canAccessAllStores: canAccessAllStores(profile.role, defs),
        storeIds,
        highlightReportId,
      }),
    [defs, highlightReportId, profile.role, storeIds],
  );

  const reportsQuery = useMemo(
    () =>
      reportsWhere === null
        ? {
            profiles: { stores: {}, avatarFile: {} },
            reviewEvents: {},
          }
        : {
            reports: {
              ...(reportsWhere ? { $: { where: reportsWhere } } : {}),
              responses: { media: { file: {} } },
              store: {},
            },
            profiles: { stores: {}, avatarFile: {} },
            reviewEvents: {},
          },
    [reportsWhere],
  );

  const { data, isLoading: reportsLoading, error: reportsError } = db.useQuery(reportsQuery);
  const {
    data: logbookData,
    isLoading: logbookLoading,
    error: logbookError,
  } = db.useQuery({
    logbookEntries: {
      store: {},
      photo: {},
      sourceMedia: {},
      resolutionMedia: {},
      resolutionProofHistory: {},
    },
  });

  const allProfiles: Profile[] = (data?.profiles ?? []) as Profile[];
  const allEvents = (data?.reviewEvents ?? []) as ReviewEvent[];
  const reports = useMemo(
    () =>
      filterReportsAwaitingReview((data?.reports ?? []) as Report[], profile, defs),
    [data?.reports, profile, defs],
  );
  const logbookIssues = useMemo(() => {
    return ((logbookData?.logbookEntries ?? []) as LogbookEntry[]).filter(
      (e) =>
        isLogbookIssue(e) &&
        resolveLogbookIssueStatus(e) === 'waiting_approval' &&
        canReviewLogbookIssue(profile, e, defs),
    );
  }, [logbookData?.logbookEntries, profile, defs]);

  useEffect(() => {
    if (!highlightReportId) return;
    const el = document.querySelector(`[data-report-id="${highlightReportId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('report-card--highlight');
      const timer = window.setTimeout(() => {
        el.classList.remove('report-card--highlight');
      }, 2500);
      return () => window.clearTimeout(timer);
    }
  }, [highlightReportId, highlightOpenKey, reports, surface]);

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
    ]);
    void deliverLogbookEvent({
      entryId: entry.id,
      eventType: 'approved',
      eventVersion: now,
      note: note.trim(),
    });
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
    ]);
    void deliverLogbookEvent({
      entryId: entry.id,
      eventType: 'correction_requested',
      eventVersion: now,
      note: note.trim(),
    });
  }

  function openFeedbackModal(
    report: Report,
    response: ReportResponse,
    status: 'rejected' | 'need_correction',
  ) {
    if (!canReviewReportItem(profile, report, response, defs)) {
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
    if (!canReviewReportItem(profile, report, response, defs)) {
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
      defs,
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
        // Lazy backfill storeId on legacy responses so Instant store-scoped rules apply.
        ...(!response.storeId && report.storeId ? { storeId: report.storeId } : {}),
      }),
      buildItemReviewEvent(report, response, status, reason, profile, now, {
        feedbackCode: feedback?.feedbackCode,
        feedbackNote: feedback?.feedbackNote,
      }),
      ...notificationTxs,
    ]);
    schedulePushDeliveryFromTxs(notificationTxs);

    // First reject/correction in a waiting cycle → Store Chat handoff (server-deduped).
    if (status === 'rejected' || status === 'need_correction') {
      const cycleKey = String(report.updatedAt || report.submittedAt || now).trim() || now;
      void deliverReportEvent({
        reportId: report.id,
        eventType: 'report_action_required',
        eventVersion: cycleKey,
        note: reason,
        itemTitle: response.title,
        responseId: response.id,
      });
    }
  }

  async function handleFeedbackConfirm(result: FeedbackResult) {
    if (!pendingFeedback) return;
    const { report, response, status } = pendingFeedback;
    setPendingFeedback(null);
    await updateResponseStatus(report, response, status, result);
  }

  async function markReportApproved(report: Report) {
    if (!canReviewReport(profile, report, defs)) {
      alert(t.review.noPermissionItem);
      return;
    }
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
      defs,
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
    schedulePushDeliveryFromTxs(notificationTxs);

    // Finalize-with-issues only; server skips if action_required already delivered this cycle.
    if (newStatus === 'rejected') {
      const cycleKey =
        String(report.updatedAt || report.submittedAt || nowIso()).trim() || nowIso();
      void deliverReportEvent({
        reportId: report.id,
        eventType: 'report_finalized',
        eventVersion: cycleKey,
        reportStatus: newStatus,
      });
    }
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
          const submitterProfile = allProfiles.find(
            (p) => p.userId === (entry.resolutionSubmittedByUserId || ''),
          );
          const creatorProfile = allProfiles.find((p) => p.userId === entry.authorUserId);
          const entryEvents = allEvents.filter((e) => e.logbookEntryId === entry.id);
          const sourceMedia = resolveSourceMedia(entry);
          const resolutionProofs = resolveResolutionProofs(entry);
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
                {t.review.submittedBy}{' '}
                <IdentityWithAvatar profile={creatorProfile}>{creator}</IdentityWithAvatar>
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
                {t.logbook.resolvedBySubmitter}:{' '}
                <IdentityWithAvatar profile={submitterProfile}>{submitter}</IdentityWithAvatar>
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
              {resolutionProofs.current.length + resolutionProofs.history.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">{t.logbook.resolutionProof}</div>
                  {resolutionProofs.current.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div className="small" style={{ marginBottom: 4 }}>
                        {t.logbook.proofLatest}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          overflowX: 'auto',
                          paddingBottom: 4,
                          alignItems: 'flex-start',
                        }}
                      >
                        {resolutionProofs.current.map((m) => (
                          <div key={m.id} style={{ flex: '0 0 auto', minWidth: 120 }}>
                            <ProofPhoto media={{ id: m.id, url: m.url }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {resolutionProofs.history.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="small" style={{ marginBottom: 4 }}>
                        {t.logbook.proofPrevious}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          overflowX: 'auto',
                          paddingBottom: 4,
                          alignItems: 'flex-start',
                        }}
                      >
                        {resolutionProofs.history.map((m) => (
                          <div key={m.id} style={{ flex: '0 0 auto', minWidth: 120 }}>
                            <ProofPhoto media={{ id: m.id, url: m.url }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
          <p>
            {logbookLoading
              ? t.common.loading
              : logbookError
                ? t.review.loadError
                : t.review.noLogbookAwaiting}
          </p>
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
        const reportSubmitterProfile = allProfiles.find(
          (p) => p.userId === report.submittedByUserId,
        );

        return (
          <div
            className={`card${highlightReportId === report.id ? ' report-card--highlight' : ''}`}
            key={report.id}
            data-report-id={report.id}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {report.storeCode} — {report.templateName}
                </h2>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  {report.reportDate} · {t.review.submittedBy}{' '}
                  <IdentityWithAvatar profile={reportSubmitterProfile}>
                    {reportSubmitterName}
                  </IdentityWithAvatar>
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
              const itemSubmitterUserId = resp.submittedByUserId || report.submittedByUserId;
              const itemSubmitterName = resolveActorDisplay(
                itemSubmitterUserId,
                undefined,
                allProfiles,
              );
              const itemSubmitterProfile = allProfiles.find(
                (p) => p.userId === itemSubmitterUserId,
              );
              return (
                <div className="item-card" key={resp.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{resp.title}</h3>
                    <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                  </div>
                  <p className="small">
                    By{' '}
                    <IdentityWithAvatar profile={itemSubmitterProfile}>
                      {itemSubmitterName}
                    </IdentityWithAvatar>{' '}
                    · {resp.section} · {resp.proofType}
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
          <p>
            {reportsLoading
              ? t.common.loading
              : reportsError
                ? t.review.loadError
                : t.review.noAwaitingReview}
          </p>
        </div>
      )}
    </div>
  );
}
