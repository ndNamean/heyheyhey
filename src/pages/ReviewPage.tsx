import { db } from '../db';
import { canApproveItem, canReview } from '../lib/roles';
import {
  buildItemReviewNotifications,
  buildReportFinalizedNotifications,
} from '../lib/notifications';
import { badgeClass, nowIso } from '../lib/utils';
import ProofPhoto from '../components/ProofPhoto';
import type { MediaRecord, Profile, Report, ReportResponse } from '../types';

interface Props {
  profile: Profile;
}

export default function ReviewPage({ profile }: Props) {
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
    return <div className="card">You do not have permission to review reports.</div>;
  }

  async function updateResponseStatus(
    report: Report,
    response: ReportResponse,
    status: 'approved' | 'rejected' | 'need_correction',
  ) {
    const approverRoles = JSON.parse(response.approverRolesJson || '[]') as import('../types').Role[];
    if (
      !canApproveItem(
        response.submittedByRole as import('../types').Role,
        profile.role,
        approverRoles,
      )
    ) {
      alert('You do not have permission to approve this item.');
      return;
    }

    let reason = '';
    if (status !== 'approved') {
      reason =
        prompt(status === 'rejected' ? 'Rejection reason?' : 'Correction note?') ?? status;
      if (!reason.trim()) {
        alert('Please enter feedback for the submitter.');
        return;
      }
    }

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
        approvedByUserId: profile.userId,
        approvedAt: now,
        updatedAt: now,
      }),
      ...notificationTxs,
    ]);
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
      <div className="card">
        <h1>Review Reports</h1>
        <p className="small">Reject/correct items with a comment — feedback is sent to the submitter and their supervisors when reviewed by a higher role.</p>
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
                  {report.reportDate} · Submitted by {report.submittedByRole} ·{' '}
                  <span className={badgeClass(report.status)}>{report.status}</span> ·{' '}
                  {report.completionPercent ?? 0}% complete
                </p>
              </div>
              {pendingCount > 0 && (
                <span className="badge warn">{pendingCount} pending</span>
              )}
            </div>

            {responses.map((resp) => {
              const media = (resp.media ?? []) as MediaRecord[];
              return (
                <div className="item-card" key={resp.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{resp.title}</h3>
                    <span className={badgeClass(resp.status)}>{resp.status}</span>
                  </div>
                  <p className="small">
                    By {resp.submittedByRole} · {resp.section} · {resp.proofType}
                  </p>
                  {resp.note && (
                    <p>
                      <strong>Note:</strong> {resp.note}
                    </p>
                  )}
                  {resp.numberValue && (
                    <p>
                      <strong>Number:</strong> {resp.numberValue}
                    </p>
                  )}
                  {resp.rejectionReason && resp.status !== 'approved' && (
                    <p className="small" style={{ color: '#b00020' }}>
                      Reason: {resp.rejectionReason}
                    </p>
                  )}
                  {media.length > 0 && (
                    <div className="proof-photo-grid">
                      {media.map((m) => (
                        <div className="proof-photo-card" key={m.id}>
                          <ProofPhoto media={m} />
                          {m.photoCode && !m.storageDeleted && (
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
                        Approve
                      </button>
                      <button
                        className="danger"
                        onClick={() => updateResponseStatus(report, resp, 'rejected')}
                      >
                        Reject
                      </button>
                      <button
                        className="secondary"
                        onClick={() => updateResponseStatus(report, resp, 'need_correction')}
                      >
                        Correction
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
                Finalise report
              </button>
            )}
          </div>
        );
      })}

      {!reports.length && (
        <div className="card">
          <p>No reports awaiting review.</p>
        </div>
      )}
    </div>
  );
}
