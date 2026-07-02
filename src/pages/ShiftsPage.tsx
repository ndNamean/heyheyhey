import { useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { canReview } from '../lib/roles';
import { badgeClass, nowIso, todayYmd } from '../lib/utils';
import type { Profile, Shift, Store } from '../types';

interface Props {
  profile: Profile;
}

export default function ShiftsPage({ profile }: Props) {
  const [date, setDate] = useState(todayYmd);
  const [tab, setTab] = useState<'schedule' | 'clockin'>('schedule');
  const [newShift, setNewShift] = useState({
    storeId: '',
    employeeEmail: '',
    role: 'staff',
    startTime: '08:00',
    endTime: '17:00',
    hourlyRate: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [clockingIn, setClockingIn] = useState<string | null>(null);

  const { data } = db.useQuery({
    shifts: {
      $: { where: { date } },
      store: {},
      employee: {},
      clockEvents: {},
    },
    stores: {},
    profiles: { $: { where: { approvalStatus: 'approved' } } },
  });

  const shifts: Shift[] = (data?.shifts ?? []) as Shift[];
  const stores: Store[] = (data?.stores ?? []) as Store[];

  // Filter shifts to user's scope
  const myShifts =
    profile.role === 'owner' || profile.role === 'areaManager'
      ? shifts
      : shifts.filter(
          (s) =>
            s.employeeUserId === profile.userId ||
            (profile.stores ?? []).some((st) => st.id === s.storeId),
        );

  async function createShift() {
    if (!newShift.storeId || !newShift.employeeEmail) {
      return alert('Store and employee email are required');
    }
    setSaving(true);
    try {
      const profiles: Profile[] = (data?.profiles ?? []) as Profile[];
      const employee = profiles.find((p) => p.email === newShift.employeeEmail);
      if (!employee) return alert('No approved user found with that email');

      await db.transact(
        db.tx.shifts[id()]
          .update({
            storeId: newShift.storeId,
            employeeUserId: employee.userId,
            role: newShift.role,
            date,
            startTime: newShift.startTime,
            endTime: newShift.endTime,
            hourlyRate: parseFloat(newShift.hourlyRate) || 0,
            status: 'scheduled',
            swapRequestedByUserId: '',
            swapApprovedByUserId: '',
            notes: newShift.notes,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          })
          .link({ store: newShift.storeId, employee: employee.id }),
      );
      setNewShift({ ...newShift, employeeEmail: '', notes: '' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create shift');
    } finally {
      setSaving(false);
    }
  }

  async function recordClock(shift: Shift, type: 'clockIn' | 'clockOut') {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    setClockingIn(shift.id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const store = shift.store;
        let gpsValid = false;
        if (store?.lat && store?.lng && store?.geofenceRadiusM) {
          const dist = haversine(
            pos.coords.latitude,
            pos.coords.longitude,
            store.lat,
            store.lng,
          );
          gpsValid = dist <= (store.geofenceRadiusM ?? 200);
        }

        await db.transact(
          db.tx.clockEvents[id()]
            .update({
              shiftId: shift.id,
              employeeUserId: profile.userId,
              storeId: shift.storeId,
              type,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              photoCode: '',
              timestamp: nowIso(),
              gpsValid,
              createdAt: nowIso(),
            })
            .link({ shift: shift.id }),
        );
        setClockingIn(null);
        alert(gpsValid ? `${type === 'clockIn' ? 'Clock-in' : 'Clock-out'} recorded.` : `${type === 'clockIn' ? 'Clock-in' : 'Clock-out'} recorded. Note: outside geofence.`);
      },
      (err) => {
        setClockingIn(null);
        alert('GPS error: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  if (!canReview(profile.role) && profile.role !== 'staff') {
    return <div className="card">You do not have access to shifts.</div>;
  }

  return (
    <div>
      <div className="card">
        <h1>Shifts</h1>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </label>
        <div className="tabs" style={{ marginTop: 12 }}>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>
            Schedule
          </button>
          <button className={tab === 'clockin' ? 'active' : ''} onClick={() => setTab('clockin')}>
            Clock in/out
          </button>
        </div>
      </div>

      {tab === 'schedule' && canReview(profile.role) && (
        <div className="card">
          <h2>Add shift</h2>
          <div className="grid two">
            <label>
              Store
              <select
                value={newShift.storeId}
                onChange={(e) => setNewShift({ ...newShift, storeId: e.target.value })}
              >
                <option value="">Select store</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Employee email
              <input
                value={newShift.employeeEmail}
                onChange={(e) => setNewShift({ ...newShift, employeeEmail: e.target.value })}
                placeholder="user@example.com"
              />
            </label>
            <label>
              Role
              <select
                value={newShift.role}
                onChange={(e) => setNewShift({ ...newShift, role: e.target.value })}
              >
                {['staff', 'leader', 'subleader', 'manager'].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hourly rate
              <input
                type="number"
                value={newShift.hourlyRate}
                onChange={(e) => setNewShift({ ...newShift, hourlyRate: e.target.value })}
              />
            </label>
            <label>
              Start time
              <input
                type="time"
                value={newShift.startTime}
                onChange={(e) => setNewShift({ ...newShift, startTime: e.target.value })}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                value={newShift.endTime}
                onChange={(e) => setNewShift({ ...newShift, endTime: e.target.value })}
              />
            </label>
          </div>
          <button style={{ marginTop: 12 }} onClick={createShift} disabled={saving}>
            {saving ? 'Adding...' : 'Add shift'}
          </button>
        </div>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Store</th>
              <th>Time</th>
              <th>Role</th>
              <th>Status</th>
              {tab === 'clockin' && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {myShifts.map((s) => {
              const clocked = (s as Shift & { clockEvents?: { type: string }[] }).clockEvents ?? [];
              const hasClockedIn = clocked.some((c) => c.type === 'clockIn');
              const hasClockedOut = clocked.some((c) => c.type === 'clockOut');
              const emp = (s as Shift & { employee?: Profile }).employee;
              return (
                <tr key={s.id}>
                  <td>
                    {emp?.displayName || emp?.email || s.employeeUserId}
                    <br />
                    <span className="small">{s.role}</span>
                  </td>
                  <td>
                    {(s as Shift & { store?: Store }).store?.code ?? '—'}
                  </td>
                  <td className="small">
                    {s.startTime} – {s.endTime}
                  </td>
                  <td>{s.role}</td>
                  <td>
                    <span className={badgeClass(s.status)}>{s.status}</span>
                    {hasClockedIn && !hasClockedOut && (
                      <span className="badge good" style={{ marginLeft: 4 }}>
                        In
                      </span>
                    )}
                    {hasClockedOut && (
                      <span className="badge" style={{ marginLeft: 4 }}>
                        Out
                      </span>
                    )}
                  </td>
                  {tab === 'clockin' && s.employeeUserId === profile.userId && (
                    <td>
                      {!hasClockedIn ? (
                    <button
                        className="success"
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => recordClock(s, 'clockIn')}
                        disabled={clockingIn === s.id}
                      >
                        {clockingIn === s.id ? '...' : 'Clock in'}
                      </button>
                    ) : !hasClockedOut ? (
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                        onClick={() => recordClock(s, 'clockOut')}
                        disabled={clockingIn === s.id}
                      >
                          {clockingIn === s.id ? '...' : 'Clock out'}
                        </button>
                      ) : (
                        <span className="small">Done</span>
                      )}
                    </td>
                  )}
                  {tab === 'clockin' && s.employeeUserId !== profile.userId && <td />}
                </tr>
              );
            })}
            {!myShifts.length && (
              <tr>
                <td colSpan={6}>No shifts for {date}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Simple haversine distance in metres
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
