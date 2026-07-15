import { useMemo, useState } from 'react';
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

  return (
    <div className="card table-wrap scheduled-task-completion">
      <div className="scheduled-task-completion-header">
        <div>
          <h2 style={{ margin: 0 }}>{t.dashboard.scheduledTasksTitle}</h2>
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
        <div className="scheduled-task-table-scroll">
          <table className="scheduled-task-table">
            <thead>
              <tr>
                <th>{t.common.template}</th>
                <th>{t.dashboard.item}</th>
                <th>{t.common.store}</th>
                <th>{t.dashboard.scheduledTasksFrequency}</th>
                <th>{t.dashboard.scheduledTasksDeadline}</th>
                <th>{t.dashboard.scheduledTasksExpected}</th>
                <th>{t.dashboard.scheduledTasksCompleted}</th>
                <th>{t.dashboard.scheduledTasksCompletionPct}</th>
                <th>{t.dashboard.scheduledTasksOnTime}</th>
                <th>{t.dashboard.scheduledTasksOnTimePct}</th>
                <th>{t.dashboard.scheduledTasksAvgTime}</th>
                <th>{t.dashboard.scheduledTasksLate}</th>
                <th>{t.dashboard.scheduledTasksAvgLate}</th>
                <th>{t.dashboard.scheduledTasksOverdue}</th>
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
      )}
    </div>
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
