import { db } from '../db';
import type { Profile } from '../types';

interface Props {
  profile: Profile;
  setPage: (p: string) => void;
}

export default function StaffHome({ profile, setPage }: Props) {
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
      <div className="card">
        <h1>Hello, {profile.displayName || profile.email.split('@')[0]}</h1>
        <p className="small">
          Role: <span className="badge">{profile.role}</span>
        </p>
      </div>

      {pendingSlots.length > 0 ? (
        <div className="card">
          <h2>Today's scheduled tasks</h2>
          {pendingSlots.map((slot) => (
            <div className="item-card" key={slot.id} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, flex: 1 }}>{slot.templateName}</h3>
                <span className={slot.status === 'missed' ? 'badge bad' : 'badge warn'}>
                  {slot.status === 'missed' ? 'Missed' : `Due: ${slot.dueTime}`}
                </span>
              </div>
              <button style={{ marginTop: 6 }} onClick={() => setPage('submit')}>
                Start checklist
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <h2>Today's tasks</h2>
          <p className="small">Tap Submit to complete your store checklist with photo proof.</p>
          <p>
            <span className="badge warn">Tip</span> Allow location and camera when prompted.
          </p>
          <button style={{ marginTop: 8 }} onClick={() => setPage('submit')}>
            Start report
          </button>
        </div>
      )}

      {storeNames && (
        <div className="card">
          <h3>Your stores</h3>
          <p className="small">{storeNames}</p>
        </div>
      )}
    </div>
  );
}
