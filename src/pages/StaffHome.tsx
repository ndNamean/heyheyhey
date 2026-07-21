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
import type { Page } from '../components/Nav';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
  setPage: (p: Page) => void;
  onStartReport: () => void;
  onFixReport: (reportId: string) => void;
  onProposeChecklistItem: () => void;
  onOpenProposals: () => void;
}

export default function StaffHome({
  profile,
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
  });

  const slots = data?.reportSlots ?? [];
  const pendingSlots = slots.filter(
    (s) => s.status === 'pending' || s.status === 'missed',
  );

  const storeNames = (profile.stores ?? []).map((s) => `${s.code} — ${s.name}`).join(', ');

  return (
    <div>
      <MyReportsPanel profile={profile} onFixReport={onFixReport} />
      <FeedbackInbox userId={profile.userId} />

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
