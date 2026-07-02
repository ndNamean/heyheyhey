import { useMemo, useState } from 'react';
import { db } from '../db';
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
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(todayYmd);
  const [filterStoreId, setFilterStoreId] = useState('all');

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

  const displayStores = profile.role === 'owner' || profile.role === 'areaManager'
    ? stores
    : (profile.stores ?? []);

  return (
    <div>
      <div className="card">
        <h1>Operation Dashboard</h1>
        <p className="small">
          {profile.displayName} — {profile.role}
        </p>
      </div>

      <div className="card">
        <h2>Filters</h2>
        <div className="grid two">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Store
            <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)}>
              <option value="all">All stores</option>
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
          <div className="small">Completion</div>
          <div className="metric">{metrics.completion}%</div>
        </div>
        <div className="card">
          <div className="small">Compliance</div>
          <div className="metric">{metrics.compliance}%</div>
        </div>
        <div className="card">
          <div className="small">Reports</div>
          <div className="metric">{metrics.reportCount}</div>
        </div>
        <div className="card">
          <div className="small">Failed items</div>
          <div className="metric">{metrics.failed.length}</div>
        </div>
      </div>

      {approvalShare.length > 0 && (
        <div className="card table-wrap">
          <h2>Approvals by role</h2>
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Count</th>
                <th>Share</th>
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

      <div className="card table-wrap">
        <h2>Failed items</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Section</th>
              <th>Category</th>
              <th>Times</th>
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
                <td colSpan={4}>No failed items in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>Recent reports</h2>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Template</th>
              <th>Date</th>
              <th>Status</th>
              <th>Completion</th>
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
                  <span className={badgeClass(r.status)}>{r.status}</span>
                </td>
                <td>{r.completionPercent ?? 0}%</td>
              </tr>
            ))}
            {!reports.length && (
              <tr>
                <td colSpan={5}>No reports in this date range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
