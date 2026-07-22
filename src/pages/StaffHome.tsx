import { useMemo } from 'react';
import { db } from '../db';
import FeedbackInbox from '../components/FeedbackInbox';
import MyReportsPanel from '../components/MyReportsPanel';
import ReportReviewStatusPanel from '../components/ReportReviewStatusPanel';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  canAccessChecklistItemProposals,
  canEditMaster,
  canProposeTemplateItem,
  canReview,
} from '../lib/roles';
import {
  countAssignedIssueBreakdown,
  countAssignedOpenOrOverdue,
  isAssignedUnresolvedIssue,
} from '../lib/logbook';
import type { Page } from '../components/Nav';
import type { LogbookEntry, Profile } from '../types';

interface Props {
  profile: Profile;
  setPage: (p: Page) => void;
  onOpenLogbook?: (filter?: string) => void;
  onStartReport: () => void;
  onFixReport: (reportId: string) => void;
  onProposeChecklistItem: () => void;
  onOpenProposals: () => void;
}

export default function StaffHome({
  profile,
  setPage,
  onOpenLogbook,
  onStartReport,
  onFixReport,
  onProposeChecklistItem,
  onOpenProposals,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = db.useQuery({
    reportSlots: {
      $: {
        where: {
          scheduledDate: today,
          assignedRole: profile.role,
        },
      },
      store: {},
    },
    logbookEntries: {},
  });

  const slots = data?.reportSlots ?? [];
  const pendingSlots = slots.filter(
    (s) => s.status === 'pending' || s.status === 'missed',
  );

  const logbookEntries = (data?.logbookEntries ?? []) as LogbookEntry[];
  const assignedCount = useMemo(
    () => countAssignedOpenOrOverdue(profile, logbookEntries, defs),
    [profile, logbookEntries, defs],
  );
  const assignedBreakdown = useMemo(
    () => countAssignedIssueBreakdown(profile, logbookEntries, defs),
    [profile, logbookEntries, defs],
  );
  const hasAssigned = useMemo(
    () => logbookEntries.some((e) => isAssignedUnresolvedIssue(profile, e, defs)),
    [logbookEntries, profile, defs],
  );

  const storeNames = (profile.stores ?? []).map((s) => `${s.code} — ${s.name}`).join(', ');

  function openAssignedIssues() {
    if (onOpenLogbook) onOpenLogbook('my-assigned');
    else setPage('logbook');
  }

  return (
    <div>
      <MyReportsPanel profile={profile} onFixReport={onFixReport} />
      <FeedbackInbox userId={profile.userId} onOpenLogbookEntry={(entryId) => {
        try {
          sessionStorage.setItem('logbookHighlightEntryId', entryId);
          sessionStorage.setItem('logbookInitialFilter', 'my-assigned');
          sessionStorage.setItem('logbookOpenResolutionEntryId', entryId);
        } catch {
          /* ignore */
        }
        setPage('logbook');
      }} />

      {canReview(profile.role, defs) && !canEditMaster(profile.role, defs) && (
        <ReportReviewStatusPanel profile={profile} />
      )}

      <div className="card">
        <h1>
          {t.common.hello}, {profile.displayName || profile.email.split('@')[0]}
        </h1>
        <p className="small">
          {t.staffHome.role}: <span className="badge">{profile.role}</span>
        </p>
      </div>

      {(hasAssigned || assignedCount > 0) && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{t.staffHome.assignedIssues}</h2>
            {assignedCount > 0 && <span className="badge warn">{assignedCount}</span>}
          </div>
          <p className="small">{t.staffHome.assignedIssuesHint}</p>
          <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <span className="badge">
              {t.staffHome.assignedOpen}: {assignedBreakdown.open}
            </span>
            <span className="badge">
              {t.staffHome.assignedInProgress}: {assignedBreakdown.inProgress}
            </span>
            <span className="badge">
              {t.staffHome.assignedWaiting}: {assignedBreakdown.waiting}
            </span>
            <span className="badge warn">
              {t.staffHome.assignedCorrection}: {assignedBreakdown.correction}
            </span>
            <span className="badge bad">
              {t.staffHome.assignedOverdue}: {assignedBreakdown.overdue}
            </span>
          </div>
          <button style={{ marginTop: 8 }} type="button" onClick={openAssignedIssues}>
            {t.staffHome.openAssignedIssues}
          </button>
        </div>
      )}

      {(canProposeTemplateItem(profile.role, defs) ||
        canAccessChecklistItemProposals(profile.role, defs)) && (
        <div className="card">
          <h2>{t.checklistProposals.title}</h2>
          <p className="small">{t.checklistProposals.subtitle}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {canProposeTemplateItem(profile.role, defs) && (
              <button type="button" onClick={onProposeChecklistItem}>
                {t.staffHome.proposeChecklistItem}
              </button>
            )}
            {canAccessChecklistItemProposals(profile.role, defs) && (
              <button type="button" className="secondary" onClick={onOpenProposals}>
                {t.checklistProposals.viewAll}
              </button>
            )}
          </div>
        </div>
      )}

      {pendingSlots.length > 0 ? (
        <div className="card">
          <h2>{t.staffHome.todaysScheduled}</h2>
          {pendingSlots.map((slot) => (
            <div className="item-card" key={slot.id} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, flex: 1 }}>{slot.templateName}</h3>
                <span className={slot.status === 'missed' ? 'badge bad' : 'badge warn'}>
                  {slot.status === 'missed'
                    ? t.staffHome.missed
                    : `${t.staffHome.due}: ${slot.dueTime}`}
                </span>
              </div>
              <button style={{ marginTop: 6 }} onClick={onStartReport}>
                {t.staffHome.startChecklist}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <h2>{t.staffHome.todaysTasks}</h2>
          <p className="small">{t.staffHome.submitHint}</p>
          <p>
            <span className="badge warn">{t.common.tip}</span> {t.staffHome.locationCameraTip}
          </p>
          <button style={{ marginTop: 8 }} onClick={onStartReport}>
            {t.staffHome.startReport}
          </button>
        </div>
      )}

      {storeNames && (
        <div className="card">
          <h3>{t.staffHome.yourStores}</h3>
          <p className="small">{storeNames}</p>
        </div>
      )}
    </div>
  );
}
