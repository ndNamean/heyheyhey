import { useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import {
  buildReportTimeline,
  compactTimelineSummary,
  formatDurationMs,
  type ReportTimelineData,
} from '../lib/reviewTimeline';
import { badgeClass } from '../lib/utils';
import type { Notification, Report, ReviewEvent, ReviewEventType } from '../types';

interface Props {
  report: Report;
  events?: ReviewEvent[];
  notifications?: Notification[];
  compact?: boolean;
  defaultExpanded?: boolean;
}

function eventLabel(
  t: ReturnType<typeof useLang>['t'],
  eventType: ReviewEventType,
): string {
  const map: Record<ReviewEventType, string> = {
    submitted: t.timeline.submitted,
    resubmitted: t.timeline.resubmitted,
    item_approved: t.timeline.approved,
    item_rejected: t.timeline.rejected,
    item_correction: t.timeline.correction,
    report_finalized: t.timeline.finalized,
  };
  return map[eventType] ?? eventType;
}

export default function ReportTimeline({
  report,
  events = [],
  notifications = [],
  compact = false,
  defaultExpanded = false,
}: Props) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(defaultExpanded && !compact);

  const timeline = useMemo(
    () => buildReportTimeline(report, events, notifications),
    [report, events, notifications],
  );

  if (!timeline.firstSubmittedAt && timeline.items.every((i) => !i.steps.length)) {
    return null;
  }

  const summary = compactTimelineSummary(timeline);

  if (compact && !expanded) {
    return (
      <div className="report-timeline report-timeline--compact">
        <div className="report-timeline-summary">
          <span className="small">{summary}</span>
          {timeline.correctionCycles > 0 && (
            <span className="badge warn">
              {timeline.correctionCycles} {t.timeline.correctionCycles}
            </span>
          )}
          {timeline.source === 'inferred' && (
            <span className="small report-timeline-partial">{t.timeline.partialHistory}</span>
          )}
        </div>
        <button
          type="button"
          className="report-timeline-toggle"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
        >
          {t.timeline.expand}
        </button>
      </div>
    );
  }

  return (
    <div className={`report-timeline${compact ? ' report-timeline--compact' : ''}`}>
      <div className="report-timeline-header">
        <div className="report-timeline-summary">
          <strong>{t.timeline.leadTime}:</strong>{' '}
          <span className="small">{summary}</span>
          {timeline.correctionCycles > 0 && (
            <span className="badge warn">
              {timeline.correctionCycles} {t.timeline.correctionCycles}
            </span>
          )}
        </div>
        {compact && (
          <button
            type="button"
            className="report-timeline-toggle"
            onClick={() => setExpanded(false)}
            aria-expanded
          >
            {t.timeline.collapse}
          </button>
        )}
      </div>

      {timeline.source === 'inferred' && (
        <p className="small report-timeline-partial">{t.timeline.partialHistory}</p>
      )}

      <TimelineBody t={t} timeline={timeline} />
    </div>
  );
}

function TimelineBody({
  t,
  timeline,
}: {
  t: ReturnType<typeof useLang>['t'];
  timeline: ReportTimelineData;
}) {
  const reportLevelSteps = timeline.reportSteps.length
    ? timeline.reportSteps
    : timeline.items.flatMap((i) => i.steps).filter((s) => !s.reportResponseId);

  return (
    <div className="report-timeline-body">
      {reportLevelSteps.length > 0 && (
        <div className="report-timeline-section">
          <div className="report-timeline-section-title">{t.timeline.reportMilestones}</div>
          <ul className="report-timeline-steps">
            {reportLevelSteps.map((step, idx) => (
              <li key={`${step.at}-${step.eventType}-${idx}`} className="report-timeline-step">
                <span className="report-timeline-step-time">{step.atDisplay}</span>
                <span className="report-timeline-step-label">{eventLabel(t, step.eventType)}</span>
                {step.actorRole && (
                  <span className="small">
                    {t.timeline.by} {step.actorRole}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {timeline.items.some((i) => i.steps.length > 0) && (
        <div className="report-timeline-section">
          <div className="report-timeline-section-title">{t.timeline.perItem}</div>
          {timeline.items
            .filter((i) => i.steps.length > 0)
            .map((item) => (
              <details key={item.reportResponseId} className="report-timeline-item">
                <summary>
                  <span>{item.itemTitle}</span>
                  <span className={badgeClass(item.currentStatus)}>
                    {statusLabel(t, item.currentStatus)}
                  </span>
                  {item.durationMs != null && (
                    <span className="small">
                      {t.timeline.duration}: {formatDurationMs(item.durationMs)}
                    </span>
                  )}
                </summary>
                <ul className="report-timeline-steps">
                  {item.steps.map((step, idx) => (
                    <li key={`${step.at}-${step.eventType}-${idx}`} className="report-timeline-step">
                      <span className="report-timeline-step-time">{step.atDisplay}</span>
                      <span className="report-timeline-step-label">{eventLabel(t, step.eventType)}</span>
                      {step.actorRole && (
                        <span className="small">
                          {t.timeline.by} {step.actorRole}
                        </span>
                      )}
                      {step.note && <span className="report-timeline-step-note">{step.note}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
        </div>
      )}
    </div>
  );
}

export function ReportTimelineLeadCell({
  report,
  events = [],
  notifications = [],
}: {
  report: Report;
  events?: ReviewEvent[];
  notifications?: Notification[];
}) {
  const { t } = useLang();
  const timeline = useMemo(
    () => buildReportTimeline(report, events, notifications),
    [report, events, notifications],
  );

  if (!timeline.firstSubmittedAt) return <span className="small">—</span>;

  const duration = formatDurationMs(timeline.totalDurationMs);
  const label = timeline.finalizedAt ? duration : t.timeline.pending;

  return (
    <span className="small" title={compactTimelineSummary(timeline)}>
      {label}
    </span>
  );
}
