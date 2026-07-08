import { useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { canApproveItem, canReview } from '../lib/roles';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildItemReviewNotifications,
  buildReportFinalizedNotifications,
} from '../lib/notifications';
import { badgeClass, nowIso } from '../lib/utils';
import ProofPhoto from '../components/ProofPhoto';
import ProofMediaDetails from '../components/ProofMediaDetails';
import ReviewFeedbackModal, { type FeedbackResult } from '../components/ReviewFeedbackModal';
import { isVideoMedia } from '../lib/mediaMime';
import type { MediaRecord, Profile, Report, ReportResponse } from '../types';

interface Props {
  profile: Profile;
}

interface PendingFeedback {
  report: Report;
  response: ReportResponse;
  status: 'rejected' | 'need_correction';
}

export default function ReviewPage({ profile }: Props) {
  const { t } = useLang();
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);

  const { data } = db.useQuery({
    reports: {
      $: { where: { status: 'waiting_approval' } },
      responses: { media: { file: {} } },
      store: {},
    },
    profiles: { stores: {} },
  });

  const reports: Report[] = (data?.reports ?? []) as Report[];
  const allProfiles: Profile[] = (data?.profiles ?? []) as Profile[];

  if (!canReview(profile.role)) {
    return <div className="card">{t.review.noPermission}</div>;
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
      </div>

      {reports.map((report) => {
        const responses = (report.responses ?? []) as ReportResponse[];
        const pendingCount = responses.filter((r) => r.status === 'waiting_approval').length;

        return (
          <div className="card" key={report.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {report.storeCode} — {report.templateName}
                </h2>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  {report.reportDate} · {t.review.submittedBy} {report.submittedByRole} ·{' '}
                  <span className={badgeClass(report.status)}>{statusLabel(t, report.status)}</span> ·{' '}
                  {report.completionPercent ?? 0}% {t.review.percentComplete}
                </p>
              </div>
              {pendingCount > 0 && (
                <span className="badge warn">{pendingCount} {t.review.pendingItems}</span>
              )}
            </div>

            {responses.map((resp) => {
              const media = (resp.media ?? []) as MediaRecord[];
              return (
                <div className="item-card" key={resp.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{resp.title}</h3>
                    <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                  </div>
                  <p className="small">
                    By {resp.submittedByRole} · {resp.section} · {resp.proofType}
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
                          <ProofPhoto media={m} />
                          {isVideoMedia(m.mimeType, m.fileName) && (
                            <ProofMediaDetails media={m} />
                          )}
                          {!isVideoMedia(m.mimeType, m.fileName) && m.photoCode && !m.storageDeleted && (
                            <div className="proof-photo-meta">
                              <span className="proof-photo-code">{m.photoCode}</span>
                              {m.capturedAt && (
                                <span className="proof-photo-time">{m.capturedAt.slice(0, 16)}</span>
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

      {!reports.length && (
        <div className="card">
          <p>{t.review.noAwaitingReview}</p>
        </div>
      )}
    </div>
  );
}
