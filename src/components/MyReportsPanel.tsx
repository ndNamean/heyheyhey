import { db } from '../db';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { badgeClass } from '../lib/utils';
import ReportTimeline from './ReportTimeline';
import type { Profile, Report, ReportResponse, ReviewEvent } from '../types';

interface Props {
  profile: Profile;
  onFixReport?: (reportId: string) => void;
}

export default function MyReportsPanel({ profile, onFixReport }: Props) {
  const { t } = useLang();

  const { data } = db.useQuery({
    reports: {
      $: { where: { submittedByUserId: profile.userId } },
      responses: {},
    },
    reviewEvents: {},
  });

  const allEvents = (data?.reviewEvents ?? []) as ReviewEvent[];

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
        <h2 style={{ margin: 0 }}>{t.staffHome.myReports}</h2>
        {needsAction.length > 0 && (
          <span className="badge bad">
            {needsAction.length} {t.staffHome.needAction}
          </span>
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
              <span className={badgeClass(report.status)}>{statusLabel(t, report.status)}</span>
            </div>
            <p className="small" style={{ margin: '6px 0 0' }}>
              {report.reportDate} · {t.feedback.completion} {report.completionPercent ?? 0}% ·{' '}
              {t.feedback.compliance} {report.compliancePercent ?? 0}%
            </p>

            {flagged.map((resp) => (
              <div className="feedback-report-item" key={resp.id}>
                <strong>{resp.title}</strong>
                <span className={badgeClass(resp.status)}>{statusLabel(t, resp.status)}</span>
                {resp.rejectionReason && (
                  <p className="feedback-report-reason">{resp.rejectionReason}</p>
                )}
              </div>
            ))}

            {flagged.length > 0 && onFixReport && (
              <button
                className="fix-resubmit-btn"
                style={{ marginTop: 10 }}
                onClick={() => onFixReport(report.id)}
              >
                {t.staffHome.fixResubmit} ({flagged.length}{' '}
                {flagged.length > 1 ? t.staffHome.items : t.staffHome.item})
              </button>
            )}

            <ReportTimeline
              report={report}
              events={allEvents.filter((e) => e.reportId === report.id)}
              compact
            />
          </div>
        );
      })}
    </div>
  );
}
