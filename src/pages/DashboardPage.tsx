import { useMemo, useState } from 'react';
import { db } from '../db';
import FeedbackInbox from '../components/FeedbackInbox';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { aggregateFeedbackFrequency } from '../lib/feedbackReasons';
import { badgeClass, todayYmd } from '../lib/utils';
import type { Profile, Report, ReportResponse } from '../types';

interface Props {
  profile: Profile;
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function DashboardPage({ profile }: Props) {
  const { t } = useLang();
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(todayYmd);
  const [filterStoreId, setFilterStoreId] = useState('all');
  const [showOtherDetails, setShowOtherDetails] = useState(false);

  const { data } = db.useQuery({
    reports: {
      $: {
        where: {
          reportDate: { $gte: from, $lte: to },
        },
      },
      responses: {},
      store: {},
    },
    stores: {},
    profiles: {},
  });

  const allReports: Report[] = (data?.reports ?? []) as Report[];
  const stores = data?.stores ?? [];
  const profiles = data?.profiles ?? [];

  const reports = useMemo(() => {
    let filtered = allReports;

    // Scope to accessible stores for non-owner users
    if (profile.role !== 'owner' && profile.role !== 'areaManager') {
      const accessibleIds = new Set((profile.stores ?? []).map((s) => s.id));
      filtered = filtered.filter((r) => accessibleIds.has(r.storeId));
    }

    if (filterStoreId !== 'all') {
      filtered = filtered.filter((r) => r.storeId === filterStoreId);
    }

    return filtered;
  }, [allReports, profile, filterStoreId]);

  const metrics = useMemo(() => {
    if (!reports.length) return { completion: 0, compliance: 0, reportCount: 0, failed: [] };

    const completion = Math.round(
      reports.reduce((sum, r) => sum + (r.completionPercent ?? 0), 0) / reports.length,
    );
    const compliance = Math.round(
      reports.reduce((sum, r) => sum + (r.compliancePercent ?? 0), 0) / reports.length,
    );

    // Aggregate failed items across all report responses
    const failMap: Record<string, { title: string; section: string; failureCategory: string; count: number }> =
      {};
    for (const report of reports) {
      for (const resp of (report.responses ?? []) as ReportResponse[]) {
        if (resp.status === 'rejected') {
          const key = resp.title;
          if (!failMap[key]) {
            failMap[key] = {
              title: resp.title,
              section: resp.section,
              failureCategory: resp.failureCategory,
              count: 0,
            };
          }
          failMap[key].count++;
        }
      }
    }

    return {
      completion,
      compliance,
      reportCount: reports.length,
      failed: Object.values(failMap).sort((a, b) => b.count - a.count),
    };
  }, [reports]);

  // Approval share by role
  const approvalShare = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const report of reports) {
      for (const resp of (report.responses ?? []) as ReportResponse[]) {
        if (resp.status === 'approved' && resp.approvedByUserId) {
          const approver = (profiles as Profile[]).find((p) => p.userId === resp.approvedByUserId);
          const role = approver?.role ?? 'unknown';
          counts[role] = (counts[role] ?? 0) + 1;
        }
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts).map(([role, count]) => ({
      role,
      count,
      percent: total ? Math.round((count / total) * 100) : 0,
    }));
  }, [reports, profiles]);

  const feedbackStats = useMemo(
    () => aggregateFeedbackFrequency(reports, profiles as Profile[]),
    [reports, profiles],
  );

  const displayStores = profile.role === 'owner' || profile.role === 'areaManager'
    ? stores
    : (profile.stores ?? []);

  return (
    <div>
      <FeedbackInbox userId={profile.userId} title={t.dashboard.teamFeedback} />

      <div className="card">
        <h1>{t.dashboard.title}</h1>
        <p className="small">
          {profile.displayName} — {profile.role}
        </p>
      </div>

      <div className="card">
        <h2>{t.dashboard.filters}</h2>
        <div className="grid two">
          <label>
            {t.dashboard.from}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {t.dashboard.to}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            {t.common.store}
            <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)}>
              <option value="all">{t.dashboard.allStores}</option>
              {(displayStores as { id: string; code: string; name: string }[]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid four">
        <div className="card">
          <div className="small">{t.dashboard.completion}</div>
          <div className="metric">{metrics.completion}%</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.compliance}</div>
          <div className="metric">{metrics.compliance}%</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.reports}</div>
          <div className="metric">{metrics.reportCount}</div>
        </div>
        <div className="card">
          <div className="small">{t.dashboard.failedItems}</div>
          <div className="metric">{metrics.failed.length}</div>
        </div>
      </div>

      {approvalShare.length > 0 && (
        <div className="card table-wrap">
          <h2>{t.dashboard.approvalsByRole}</h2>
          <table>
            <thead>
              <tr>
                <th>{t.common.role}</th>
                <th>{t.dashboard.count}</th>
                <th>{t.dashboard.share}</th>
              </tr>
            </thead>
            <tbody>
              {approvalShare.map((r) => (
                <tr key={r.role}>
                  <td>{r.role}</td>
                  <td>{r.count}</td>
                  <td>{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap feedback-freq-card">
        <h2>{t.dashboard.feedbackReasons}</h2>
        <p className="small">{t.dashboard.rejectionsPeriod}</p>

        {feedbackStats.rows.length > 0 ? (
          <>
            <table className="feedback-freq-table">
              <thead>
                <tr>
                  <th>{t.review.feedbackReason}</th>
                  <th>{t.dashboard.count}</th>
                  <th>{t.dashboard.share}</th>
                  <th style={{ width: '30%' }}>{t.dashboard.feedbackFreq}</th>
                </tr>
              </thead>
              <tbody>
                {feedbackStats.rows.map((row) => (
                  <tr key={row.code}>
                    <td>
                      {row.label}
                      {row.code === 'other' && feedbackStats.otherDetails.length > 0 && (
                        <button
                          type="button"
                          className="feedback-other-toggle"
                          onClick={() => setShowOtherDetails((v) => !v)}
                        >
                          {showOtherDetails ? t.dashboard.hideDetails : t.dashboard.showDetails}
                        </button>
                      )}
                    </td>
                    <td>{row.count}</td>
                    <td>{row.percent}%</td>
                    <td>
                      <div className="progress-bar" style={{ margin: 0 }}>
                        <div style={{ width: `${row.percent}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {showOtherDetails && feedbackStats.otherDetails.length > 0 && (
              <table className="feedback-other-detail">
                <thead>
                  <tr>
                    <th>{t.common.date}</th>
                    <th>{t.common.store}</th>
                    <th>{t.dashboard.item}</th>
                    <th>{t.dashboard.feedback}</th>
                    <th>{t.dashboard.reviewer}</th>
                  </tr>
                </thead>
                <tbody>
                  {feedbackStats.otherDetails.map((d) => (
                    <tr key={d.id}>
                      <td className="small">{d.reportDate}</td>
                      <td>{d.storeCode}</td>
                      <td>{d.itemTitle}</td>
                      <td className="feedback-other-text">{d.text}</td>
                      <td className="small">
                        {d.reviewerName}
                        <br />
                        <span className="badge">{d.reviewerRole}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="small">{t.dashboard.noFeedbackPeriod}</p>
        )}
      </div>

      <div className="card table-wrap">
        <h2>{t.dashboard.failedItems}</h2>
        <table>
          <thead>
            <tr>
              <th>{t.dashboard.item}</th>
              <th>{t.common.section}</th>
              <th>{t.dashboard.category}</th>
              <th>{t.dashboard.times}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.failed.map((f) => (
              <tr key={f.title}>
                <td>{f.title}</td>
                <td>{f.section}</td>
                <td>{f.failureCategory}</td>
                <td>{f.count}</td>
              </tr>
            ))}
            {!metrics.failed.length && (
              <tr>
                <td colSpan={4}>{t.dashboard.noFailedItems}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>{t.dashboard.recentReports}</h2>
        <table>
          <thead>
            <tr>
              <th>{t.common.store}</th>
              <th>{t.common.template}</th>
              <th>{t.common.date}</th>
              <th>{t.common.status}</th>
              <th>{t.dashboard.completion}</th>
            </tr>
          </thead>
          <tbody>
            {reports.slice(0, 20).map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.storeCode}</strong>
                </td>
                <td>{r.templateName}</td>
                <td>{r.reportDate}</td>
                <td>
                  <span className={badgeClass(r.status)}>{statusLabel(t, r.status)}</span>
                </td>
                <td>{r.completionPercent ?? 0}%</td>
              </tr>
            ))}
            {!reports.length && (
              <tr>
                <td colSpan={5}>{t.dashboard.noReportsInRange}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
