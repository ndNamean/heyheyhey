import { useState } from 'react';
import { db } from '../db';
import { canReview } from '../lib/roles';
import { badgeClass, nowIso } from '../lib/utils';
import type { CorrectiveAction, Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function CorrectiveActionsPage({ profile }: Props) {
  const [filter, setFilter] = useState<'open' | 'overdue' | 'verified' | 'all'>('open');

  const { data } = db.useQuery({
    correctiveActions: {},
  });

  const allActions: CorrectiveAction[] = (data?.correctiveActions ?? []) as CorrectiveAction[];

  const actions = allActions.filter((a) => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  if (!canReview(profile.role)) {
    return <div className="card">You need at least leader role to view corrective actions.</div>;
  }

  const severityBadge = (s: string) =>
    s === 'critical' ? 'badge bad' : s === 'major' ? 'badge warn' : 'badge';

  async function closeAction(action: CorrectiveAction) {
    const note = prompt('Closing note / evidence description?') ?? '';
    await db.transact(
      db.tx.correctiveActions[action.id].update({
        status: 'verified',
        evidenceNote: note,
        closedByUserId: profile.userId,
        closedAt: nowIso(),
        updatedAt: nowIso(),
      }),
    );
  }

  async function escalate(action: CorrectiveAction) {
    await db.transact(
      db.tx.correctiveActions[action.id].update({
        escalationLevel: Math.min((action.escalationLevel ?? 0) + 1, 2),
        updatedAt: nowIso(),
      }),
    );
  }

  return (
    <div>
      <div className="card">
        <h1>Corrective Actions</h1>
        <div className="tabs">
          {(['open', 'overdue', 'verified', 'all'] as const).map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {actions.map((ca) => (
        <div className="card" key={ca.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{ca.title}</h2>
            <span className={severityBadge(ca.severity)}>{ca.severity}</span>
            <span className={badgeClass(ca.status)}>{ca.status}</span>
          </div>
          <p className="small">
            Due: {ca.dueAt?.slice(0, 16) || '—'} · Assigned: {ca.assignedRole}
            {ca.escalationLevel > 0 && (
              <> · <span className="badge bad">Escalation {ca.escalationLevel}</span></>
            )}
          </p>
          {ca.evidenceNote && (
            <p className="small">
              <strong>Note:</strong> {ca.evidenceNote}
            </p>
          )}

          {(ca.status === 'open' || ca.status === 'overdue' || ca.status === 'in_progress') && (
            <div className="capture-actions" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={() => escalate(ca)}>
                Escalate
              </button>
              <button className="success" onClick={() => closeAction(ca)}>
                Mark verified
              </button>
            </div>
          )}
        </div>
      ))}

      {!actions.length && (
        <div className="card">
          <p>No corrective actions with status: {filter}.</p>
        </div>
      )}
    </div>
  );
}
