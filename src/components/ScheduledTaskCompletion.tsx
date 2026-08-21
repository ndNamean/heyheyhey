import { useMemo, useRef, useState } from 'react';
import DashboardStickyTableHeader from './DashboardStickyTableHeader';
import { useLang } from '../i18n';
import {
  calculateScheduledTaskMetrics,
  formatLateDuration,
  formatTimingOffset,
  getScheduledOccurrences,
  percentLabel,
  type ScheduledTaskMetricRow,
} from '../lib/scheduledTaskMetrics';
import { parseTemplateSchedule } from '../lib/templateSchedule';
import type { Report, ReviewEvent, Template } from '../types';

interface Props {
  templates: Template[];
  reports: Report[];
  events: ReviewEvent[];
  from: string;
  to: string;
  storeIds: string[] | null;
}

export default function ScheduledTaskCompletion({
  templates,
  reports,
  events,
  from,
  to,
  storeIds,
}: Props) {
  const { t } = useLang();
  const [filterTemplateId, setFilterTemplateId] = useState('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const scheduledTemplates = useMemo(() => {
    return templates.filter((tmpl) => {
      if (parseTemplateSchedule(tmpl.scheduleJson).enabled) return true;
      return (tmpl.scheduleVersions ?? []).some((v) =>
        parseTemplateSchedule(v.scheduleJson).enabled,
      );
    });
  }, [templates]);

  const result = useMemo(() => {
    const expected = getScheduledOccurrences({
      templates: scheduledTemplates,
      from,
      to,
      storeIds,
    });
    return calculateScheduledTaskMetrics({
      expected,
      reports,
      events,
      now: new Date(),
    });
  }, [scheduledTemplates, from, to, storeIds, reports, events]);

  const rows = useMemo(() => {
    if (filterTemplateId === 'all') return result.rows;
    return result.rows.filter((r) => r.templateId === filterTemplateId);
  }, [result.rows, filterTemplateId]);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: ScheduledTaskMetricRow[] }>();
    for (const row of rows) {
      const g = map.get(row.templateId);
      if (!g) map.set(row.templateId, { name: row.templateName, rows: [row] });
      else g.rows.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const templateOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of result.rows) seen.set(row.templateId, row.templateName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [result.rows]);

  function toggleTemplate(templateId: string) {
    setCollapsed((prev) => ({ ...prev, [templateId]: !prev[templateId] }));
  }

  const headerLabels = useMemo(
    () => [
      t.common.template,
      t.dashboard.item,
      t.common.store,
      t.dashboard.scheduledTasksFrequency,
      t.dashboard.scheduledTasksDeadline,
      t.dashboard.scheduledTasksExpected,
      t.dashboard.scheduledTasksCompleted,
      t.dashboard.scheduledTasksCompletionPct,
      t.dashboard.scheduledTasksOnTime,
      t.dashboard.scheduledTasksOnTimePct,
      t.dashboard.scheduledTasksAvgTime,
      t.dashboard.scheduledTasksLate,
      t.dashboard.scheduledTasksAvgLate,
      t.dashboard.scheduledTasksOverdue,
    ],
    [t],
  );

  return (
    <section className="dash-scroll-section">
      <div className="dash-section-heading">
        <h2
          id="scheduled-task-heading"
          data-dash-context=""
          data-dash-level="h2"
          style={{ margin: 0 }}
        >
          {t.dashboard.scheduledTasksTitle}
        </h2>
      </div>
      <div className="card scheduled-task-completion">
        <div className="scheduled-task-completion-header">
          <div>
            <p className="small" style={{ marginTop: 4 }}>
              {t.dashboard.scheduledTasksSubtitle}
            </p>
          </div>
          {templateOptions.length > 0 && (
            <label className="scheduled-task-template-filter">
              {t.common.template}
              <select
                value={filterTemplateId}
                onChange={(e) => setFilterTemplateId(e.target.value)}
              >
                <option value="all">{t.dashboard.scheduledTasksAllTemplates}</option>
                {templateOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!rows.length ? (
          <p className="small">{t.dashboard.scheduledTasksEmpty}</p>
        ) : (
          <>
            <DashboardStickyTableHeader
              labels={headerLabels}
              tableRef={tableRef}
              scrollerRef={scrollerRef}
            />
            <div
              ref={scrollerRef}
              className="scheduled-task-table-scroll dash-table-x"
              role="region"
              aria-labelledby="scheduled-task-heading"
              tabIndex={0}
            >
              <table className="scheduled-task-table" ref={tableRef}>
                <thead>
                  <tr>
                    <th scope="col">{t.common.template}</th>
                    <th scope="col">{t.dashboard.item}</th>
                    <th scope="col">{t.common.store}</th>
                    <th scope="col">{t.dashboard.scheduledTasksFrequency}</th>
                    <th scope="col">{t.dashboard.scheduledTasksDeadline}</th>
                    <th scope="col">{t.dashboard.scheduledTasksExpected}</th>
                    <th scope="col">{t.dashboard.scheduledTasksCompleted}</th>
                    <th scope="col">{t.dashboard.scheduledTasksCompletionPct}</th>
                    <th scope="col">{t.dashboard.scheduledTasksOnTime}</th>
                    <th scope="col">{t.dashboard.scheduledTasksOnTimePct}</th>
                    <th scope="col">{t.dashboard.scheduledTasksAvgTime}</th>
                    <th scope="col">{t.dashboard.scheduledTasksLate}</th>
                    <th scope="col">{t.dashboard.scheduledTasksAvgLate}</th>
                    <th scope="col">{t.dashboard.scheduledTasksOverdue}</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([templateId, group]) => {
                    const isCollapsed = !!collapsed[templateId];
                    return (
                      <TemplateGroup
                        key={templateId}
                        templateId={templateId}
                        name={group.name}
                        rows={group.rows}
                        collapsed={isCollapsed}
                        onToggle={() => toggleTemplate(templateId)}
                        t={t}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function TemplateGroup({
  name,
  rows,
  collapsed,
  onToggle,
  t,
}: {
  templateId: string;
  name: string;
  rows: ScheduledTaskMetricRow[];
  collapsed: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useLang>['t'];
}) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.expected += r.expected;
      acc.completed += r.completed;
      acc.onTime += r.onTime;
      acc.late += r.late;
      acc.overdue += r.overdueIncomplete;
      return acc;
    },
    { expected: 0, completed: 0, onTime: 0, late: 0, overdue: 0 },
  );

  return (
    <>
      <tr className="scheduled-task-group-row" onClick={onToggle}>
        <td colSpan={14}>
          <button type="button" className="scheduled-task-group-toggle">
            <span aria-hidden>{collapsed ? '▸' : '▾'}</span>
            <strong>{name}</strong>
            <span className="small">
              {rows.length} {t.dashboard.item.toLowerCase()}
              {' · '}
              {totals.completed}/{totals.expected}
              {' · '}
              {t.dashboard.scheduledTasksOverdue}: {totals.overdue}
            </span>
          </button>
        </td>
      </tr>
      {!collapsed &&
        rows.map((row) => (
          <tr key={row.key}>
            <td className="small">{row.templateName}</td>
            <td>
              <div>{row.itemTitle || '—'}</div>
              {row.section ? <div className="small">{row.section}</div> : null}
            </td>
            <td>
              <strong>{row.storeCode}</strong>
            </td>
            <td className="small">{row.frequencyLabel}</td>
            <td>{row.completionDeadline}</td>
            <td
              title={
                row.expectedFullPeriod !== row.expected
                  ? `${t.dashboard.scheduledTasksDueToDate}: ${row.expected} · ${t.dashboard.scheduledTasksFullPeriod}: ${row.expectedFullPeriod}`
                  : undefined
              }
            >
              {row.expected}
              {row.expectedFullPeriod !== row.expected ? (
                <span className="small"> / {row.expectedFullPeriod}</span>
              ) : null}
            </td>
            <td>{row.completed}</td>
            <td>
              {row.completed}/{row.expected}
              {row.completionPercentage != null
                ? ` — ${percentLabel(row.completionPercentage)}`
                : ''}
            </td>
            <td>{row.onTime}</td>
            <td>{percentLabel(row.onTimePercentage)}</td>
            <td
              title={
                row.averageTimingOffsetMs != null
                  ? formatTimingOffset(row.averageTimingOffsetMs)
                  : undefined
              }
            >
              {row.averageCompletionTime ?? '—'}
            </td>
            <td>{row.late}</td>
            <td>{formatLateDuration(row.averageLateDurationMs)}</td>
            <td>{row.overdueIncomplete}</td>
          </tr>
        ))}
    </>
  );
}
