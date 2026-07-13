import { db } from '../db';
import FeedbackInbox from '../components/FeedbackInbox';
import MyReportsPanel from '../components/MyReportsPanel';
import ReportReviewStatusPanel from '../components/ReportReviewStatusPanel';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canEditMaster, canReview } from '../lib/roles';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
  setPage: (p: string) => void;
  onStartReport: () => void;
  onFixReport: (reportId: string) => void;
}

export default function StaffHome({ profile, onStartReport, onFixReport }: Props) {
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
      <FeedbackInbox userId={profile.userId} />
      <MyReportsPanel profile={profile} onFixReport={onFixReport} />

      {canReview(profile.role, defs) && !canEditMaster(profile.role, defs) && (
        <ReportReviewStatusPanel profile={profile} />
      )}

      <div className="card">
        <h1>{t.common.hello}, {profile.displayName || profile.email.split('@')[0]}</h1>
        <p className="small">
          {t.staffHome.role}: <span className="badge">{profile.role}</span>
        </p>
      </div>

      {pendingSlots.length > 0 ? (
        <div className="card">
          <h2>{t.staffHome.todaysScheduled}</h2>
          {pendingSlots.map((slot) => (
            <div className="item-card" key={slot.id} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, flex: 1 }}>{slot.templateName}</h3>
                <span className={slot.status === 'missed' ? 'badge bad' : 'badge warn'}>
                  {slot.status === 'missed' ? t.staffHome.missed : `${t.staffHome.due}: ${slot.dueTime}`}
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
