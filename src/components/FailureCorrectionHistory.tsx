import { useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import {
  aggregateFailureCorrectionHistory,
  formatDurationMs,
  type BreakdownRow,
  type IssueInstance,
} from '../lib/failureCorrectionHistory';
import { badgeClass } from '../lib/utils';
import type { Profile, Report, ReviewEvent } from '../types';

type SortKey =
  | 'issueRate'
  | 'issueCount'
  | 'avgCorrectionTimeMs'
  | 'avgTimeToFinalApprovalMs'
  | 'repeatedIssueCount';

interface Props {
  events: ReviewEvent[];
  reports: Report[];
  profiles: Profile[];
  from: string;
  to: string;
  storeIds: string[] | null;
  onExport?: () => void;
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card failure-history-kpi">
      <div className="small">{label}</div>
      <div className="metric">{value}</div>
      {sub && <div className="small failure-history-kpi-sub">{sub}</div>}
    </div>
  );
}

function pctSub(numerator: number, denominator: number): string {
  return `${numerator} / ${denominator}`;
}

export default function FailureCorrectionHistory({
  events,
  reports,
  profiles,
  from,
  to,
  storeIds,
  onExport,
}: Props) {
  const { t } = useLang();
  const [issueTypeFilter, setIssueTypeFilter] = useState<'all' | 'rejected' | 'need_correction'>('all');
  const [sectionFilter, setSectionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('issueCount');
  const [selectedInstance, setSelectedInstance] = useState<IssueInstance | null>(null);
  const [selectedBreakdown, setSelectedBreakdown] = useState<BreakdownRow | null>(null);

  const result = useMemo(
    () =>
      aggregateFailureCorrectionHistory(events, reports, profiles, {
        from,
        to,
        storeIds,
        issueType: issueTypeFilter,
        section: sectionFilter || undefined,
        category: categoryFilter || undefined,
      }),
    [events, reports, profiles, from, to, storeIds, issueTypeFilter, sectionFilter, categoryFilter],
  );

  const sections = useMemo(() => {
    const set = new Set(result.issueInstances.map((i) => i.section).filter(Boolean));
    return [...set].sort();
  }, [result.issueInstances]);

  const categories = useMemo(() => {
    const set = new Set(result.issueInstances.map((i) => i.category).filter(Boolean));
    return [...set].sort();
  }, [result.issueInstances]);

  const sortedBreakdown = useMemo(() => {
    const rows = [...result.breakdownRows];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'number' && typeof bv === 'number') return bv - av;
      return 0;
    });
    return rows;
  }, [result.breakdownRows, sortKey]);

  const drillInstances = useMemo(() => {
    if (selectedBreakdown) {
      return result.issueInstances.filter(
        (i) =>
          i.templateItemId === selectedBreakdown.templateItemId &&
          i.storeCode === selectedBreakdown.storeCode &&
          i.itemTitle === selectedBreakdown.itemTitle,
      );
    }
    return selectedInstance ? [selectedInstance] : [];
  }, [selectedBreakdown, selectedInstance, result.issueInstances]);

  const fh = t.failureHistory;
  const { kpis } = result;

  return (
    <div className="failure-history-section">
      <div className="card table-wrap failure-history-card">
        <div className="dashboard-filters-header">
          <div>
            <h2 style={{ margin: 0 }}>{fh.title}</h2>
            <p className="small" style={{ margin: '4px 0 0' }}>
              {fh.subtitle}
            </p>
          </div>
          {onExport && (
            <button type="button" className="export-trigger-btn" onClick={onExport}>
              {t.export.export}
            </button>
          )}
        </div>

        {result.trackingSince && (
          <p className="small failure-history-tracking">
            {fh.trackingSince} {result.trackingSince.slice(0, 10)}
          </p>
        )}
        {result.hasPartialData && (
          <p className="small failure-history-partial">{fh.partialHistory}</p>
        )}

        <div className="grid two failure-history-filters">
          <label>
            {fh.issueType}
            <select
              value={issueTypeFilter}
              onChange={(e) =>
                setIssueTypeFilter(e.target.value as 'all' | 'rejected' | 'need_correction')
              }
            >
              <option value="all">{fh.allIssueTypes}</option>
              <option value="rejected">{fh.rejectedOnly}</option>
              <option value="need_correction">{fh.correctionOnly}</option>
            </select>
          </label>
          <label>
            {t.common.section}
            <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
              <option value="">{fh.allSections}</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.dashboard.category}
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{fh.allCategories}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid four failure-history-kpis">
          <KpiCard
            label={fh.issueRate}
            value={`${kpis.issueRate.percent}%`}
            sub={pctSub(kpis.issueRate.numerator, kpis.issueRate.denominator)}
          />
          <KpiCard
            label={fh.strictRejectionRate}
            value={`${kpis.strictRejectionRate.percent}%`}
            sub={pctSub(kpis.strictRejectionRate.numerator, kpis.strictRejectionRate.denominator)}
          />
          <KpiCard
            label={fh.correctionRecoveryRate}
            value={`${kpis.correctionRecoveryRate.percent}%`}
            sub={pctSub(kpis.correctionRecoveryRate.numerator, kpis.correctionRecoveryRate.denominator)}
          />
          <KpiCard
            label={fh.approvalRecoveryRate}
            value={`${kpis.approvalRecoveryRate.percent}%`}
            sub={pctSub(kpis.approvalRecoveryRate.numerator, kpis.approvalRecoveryRate.denominator)}
          />
          <KpiCard
            label={fh.avgCorrectionTime}
            value={formatDurationMs(kpis.avgCorrectionTimeMs)}
            sub={`${kpis.completedCorrectionCycles} ${fh.completedCycles}`}
          />
          <KpiCard
            label={fh.avgRereviewTime}
            value={formatDurationMs(kpis.avgRereviewTimeMs)}
          />
          <KpiCard
            label={fh.avgTimeToFinalApproval}
            value={formatDurationMs(kpis.avgTimeToFinalApprovalMs)}
          />
          <KpiCard
            label={fh.openCorrections}
            value={String(kpis.openCorrections)}
          />
        </div>

        {result.trendBuckets.length > 0 && (
          <>
            <h3 className="failure-history-subheading">{fh.trend}</h3>
            <table className="feedback-freq-table">
              <thead>
                <tr>
                  <th>{fh.period}</th>
                  <th>{fh.issueRate}</th>
                  <th>{fh.strictRejectionRate}</th>
                  <th>{fh.correctionRequestRate}</th>
                  <th>{fh.correctionRecoveryRate}</th>
                  <th>{fh.approvalRecoveryRate}</th>
                  <th>{fh.avgCorrectionTime}</th>
                  <th style={{ width: '12%' }}>{t.dashboard.count}</th>
                </tr>
              </thead>
              <tbody>
                {result.trendBuckets.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>
                      {b.issueRate}%
                      <div className="progress-bar" style={{ marginTop: 4 }}>
                        <div style={{ width: `${b.issueRate}%` }} />
                      </div>
                    </td>
                    <td>{b.strictRejectionRate}%</td>
                    <td>{b.correctionRequestRate}%</td>
                    <td>{b.correctionRecoveryRate}%</td>
                    <td>{b.approvalRecoveryRate}%</td>
                    <td>{formatDurationMs(b.avgCorrectionTimeMs)}</td>
                    <td>{b.issueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 className="failure-history-subheading">{fh.breakdown}</h3>
        <div className="failure-history-sort">
          <label className="small">
            {fh.sortBy}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="issueRate">{fh.sortIssueRate}</option>
              <option value="issueCount">{fh.sortIssueCount}</option>
              <option value="avgCorrectionTimeMs">{fh.sortSlowestCorrection}</option>
              <option value="avgTimeToFinalApprovalMs">{fh.sortSlowestApproval}</option>
              <option value="repeatedIssueCount">{fh.sortRepeated}</option>
            </select>
          </label>
        </div>

        {sortedBreakdown.length > 0 ? (
          <table className="feedback-freq-table failure-history-breakdown">
            <thead>
              <tr>
                <th>{t.dashboard.item}</th>
                <th>{t.common.section}</th>
                <th>{t.dashboard.category}</th>
                <th>{t.common.store}</th>
                <th>{fh.issues}</th>
                <th>{fh.issueRate}</th>
                <th>{fh.resubmitted}</th>
                <th>{fh.recoveryRate}</th>
                <th>{fh.repeated}</th>
                <th>{fh.avgCorrectionTime}</th>
              </tr>
            </thead>
            <tbody>
              {sortedBreakdown.map((row) => (
                <tr
                  key={row.key}
                  className="failure-history-row-clickable"
                  onClick={() => {
                    setSelectedBreakdown(row);
                    setSelectedInstance(null);
                  }}
                >
                  <td>{row.itemTitle}</td>
                  <td>{row.section}</td>
                  <td>{row.category}</td>
                  <td>{row.storeCode}</td>
                  <td>{row.issueCount}</td>
                  <td>{row.issueRate}%</td>
                  <td>{row.resubmittedCount}</td>
                  <td>{row.recoveryRate}%</td>
                  <td>{row.repeatedIssueCount}</td>
                  <td>{formatDurationMs(row.avgCorrectionTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small">{fh.noData}</p>
        )}
      </div>

      {drillInstances.length > 0 && (
        <div className="modal-overlay" onClick={() => { setSelectedInstance(null); setSelectedBreakdown(null); }}>
          <div className="card failure-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard-filters-header">
              <h2 style={{ margin: 0 }}>{fh.drillDown}</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => { setSelectedInstance(null); setSelectedBreakdown(null); }}
              >
                {t.export.close}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t.common.date}</th>
                    <th>{t.common.store}</th>
                    <th>{t.dashboard.item}</th>
                    <th>{fh.issueType}</th>
                    <th>{fh.issuedBy}</th>
                    <th>{fh.resubmittedBy}</th>
                    <th>{fh.correctionDuration}</th>
                    <th>{fh.nextReview}</th>
                    <th>{fh.finalApproved}</th>
                    <th>{t.common.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {drillInstances.map((inst) => (
                    <tr key={inst.id}>
                      <td className="small">{inst.reportDate}</td>
                      <td>{inst.storeCode}</td>
                      <td>{inst.itemTitle}</td>
                      <td>
                        <span className={badgeClass(inst.issueType === 'rejected' ? 'rejected' : 'need_correction')}>
                          {inst.issueType === 'rejected' ? fh.rejectedOnly : fh.correctionOnly}
                        </span>
                      </td>
                      <td className="small">
                        {inst.issueByName}
                        <br />
                        <span className="badge">{inst.issueByRole}</span>
                        <br />
                        {inst.issueAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="small">
                        {inst.resubmittedByName ?? '—'}
                        {inst.resubmittedAt && (
                          <>
                            <br />
                            {inst.resubmittedAt.slice(0, 16).replace('T', ' ')}
                          </>
                        )}
                      </td>
                      <td>{formatDurationMs(inst.correctionDurationMs)}</td>
                      <td className="small">
                        {inst.nextReviewByName ?? '—'}
                        {inst.nextReviewDecision && (
                          <>
                            <br />
                            {statusLabel(t, inst.nextReviewDecision)}
                            <br />
                            {formatDurationMs(inst.rereviewDurationMs)}
                          </>
                        )}
                      </td>
                      <td className="small">
                        {inst.finalApprovedByName ?? '—'}
                        {inst.finalApprovedAt && (
                          <>
                            <br />
                            {formatDurationMs(inst.timeToFinalApprovalMs)}
                          </>
                        )}
                      </td>
                      <td>
                        <span className={badgeClass(inst.currentStatus)}>
                          {statusLabel(t, inst.currentStatus)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
