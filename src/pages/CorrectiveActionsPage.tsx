import { useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { canReview } from '../lib/roles';
import { statusLabel } from '../lib/i18nUtils';
import { badgeClass, nowIso } from '../lib/utils';
import type { CorrectiveAction, Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function CorrectiveActionsPage({ profile }: Props) {
  const { t } = useLang();
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
    return <div className="card">{t.corrective.noPermission}</div>;
  }

  const severityBadge = (s: string) =>
    s === 'critical' ? 'badge bad' : s === 'major' ? 'badge warn' : 'badge';

  async function closeAction(action: CorrectiveAction) {
    const note = prompt(t.corrective.closingNotePrompt) ?? '';
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
        <h1>{t.corrective.title}</h1>
        <p className="small">{t.corrective.subtitle}</p>
        <div className="tabs">
          {(['open', 'overdue', 'verified', 'all'] as const).map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s === 'all' ? t.common.all : statusLabel(t, s)}
            </button>
          ))}
        </div>
      </div>

      {actions.map((ca) => (
        <div className="card" key={ca.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{ca.title}</h2>
            <span className={severityBadge(ca.severity)}>{ca.severity}</span>
            <span className={badgeClass(ca.status)}>{statusLabel(t, ca.status)}</span>
          </div>
          <p className="small">
            {t.corrective.due}: {ca.dueAt?.slice(0, 16) || '—'} · {t.corrective.assigned}: {ca.assignedRole}
            {ca.escalationLevel > 0 && (
              <> · <span className="badge bad">{t.corrective.escalation} {ca.escalationLevel}</span></>
            )}
          </p>
          {ca.evidenceNote && (
            <p className="small">
              <strong>{t.common.note}:</strong> {ca.evidenceNote}
            </p>
          )}

          {(ca.status === 'open' || ca.status === 'overdue' || ca.status === 'in_progress') && (
            <div className="capture-actions" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={() => escalate(ca)}>
                {t.corrective.escalate}
              </button>
              <button className="success" onClick={() => closeAction(ca)}>
                {t.corrective.markVerified}
              </button>
            </div>
          )}
        </div>
      ))}

      {!actions.length && (
        <div className="card">
          <p>{t.corrective.noActionsWithStatus} {filter === 'all' ? t.common.all : statusLabel(t, filter)}.</p>
        </div>
      )}
    </div>
  );
}
