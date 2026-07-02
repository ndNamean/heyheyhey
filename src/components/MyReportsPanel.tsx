import { db } from '../db';
import { badgeClass } from '../lib/utils';
import type { Profile, Report, ReportResponse } from '../types';

interface Props {
  profile: Profile;
}

export default function MyReportsPanel({ profile }: Props) {
  const { data } = db.useQuery({
    reports: {
      $: { where: { submittedByUserId: profile.userId } },
      responses: {},
    },
  });

  const reports = ((data?.reports ?? []) as Report[])
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
    .slice(0, 8);

  const needsAction = reports.filter((r) => {
    const responses = (r.responses ?? []) as ReportResponse[];
    return (
      r.status === 'need_correction' ||
      r.status === 'rejected' ||
      responses.some((resp) => ['rejected', 'need_correction'].includes(resp.status))
    );
  });

  if (!reports.length) return null;

  return (
    <div className="card">
      <div className="feedback-inbox-header">
        <h2 style={{ margin: 0 }}>My reports</h2>
        {needsAction.length > 0 && (
          <span className="badge bad">{needsAction.length} need action</span>
        )}
      </div>

      {reports.map((report) => {
        const responses = (report.responses ?? []) as ReportResponse[];
        const flagged = responses.filter((r) =>
          ['rejected', 'need_correction'].includes(r.status),
        );

        return (
          <div className="item-card" key={report.id} style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, flex: 1 }}>
                {report.storeCode} — {report.templateName}
              </h3>
              <span className={badgeClass(report.status)}>{report.status.replace(/_/g, ' ')}</span>
            </div>
            <p className="small" style={{ margin: '6px 0 0' }}>
              {report.reportDate} · Completion {report.completionPercent ?? 0}% · Compliance{' '}
              {report.compliancePercent ?? 0}%
            </p>

            {flagged.map((resp) => (
              <div className="feedback-report-item" key={resp.id}>
                <strong>{resp.title}</strong>
                <span className={badgeClass(resp.status)}>{resp.status.replace(/_/g, ' ')}</span>
                {resp.rejectionReason && (
                  <p className="feedback-report-reason">{resp.rejectionReason}</p>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
