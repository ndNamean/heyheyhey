import { useState } from 'react';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  canActorEditProposal,
  canActorFinalApprove,
  canActorFirstApprove,
  canActorPublish,
  cancelChecklistItemProposal,
  finalApproveChecklistItemProposal,
  firstApproveChecklistItemProposal,
  publishApprovedChecklistItemProposal,
  rejectChecklistItemProposal,
  requestChangesChecklistItemProposal,
  submitChecklistItemProposal,
} from '../lib/checklistItemProposals';
import { badgeClass } from '../lib/utils';
import type {
  ChecklistItemProposal,
  ChecklistItemProposalEvent,
  Profile,
  Template,
} from '../types';

interface Props {
  profile: Profile;
  proposal: ChecklistItemProposal;
  allProfiles: Profile[];
  existingProposals: ChecklistItemProposal[];
  onBack: () => void;
}

export default function ChecklistItemProposalDetail({
  profile,
  proposal,
  allProfiles,
  existingProposals,
  onBack,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');

  const cp = t.checklistProposals;
  const events = [...((proposal.events ?? []) as ChecklistItemProposalEvent[])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  function statusLabel(status: string): string {
    return (cp.statuses as Record<string, string>)[status] ?? status;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setComment('');
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const template = proposal.template as Template | undefined;

  return (
    <div>
      <div className="card">
        <button type="button" className="secondary" onClick={onBack}>
          {t.common.back}
        </button>
        <h1 style={{ marginTop: 12 }}>{cp.detailTitle}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h2 style={{ margin: 0, flex: 1 }}>{proposal.title}</h2>
          <span className={badgeClass(proposal.status)}>{statusLabel(proposal.status)}</span>
        </div>
        <p className="small">
          {cp.targetTemplate}: {proposal.templateNameSnapshot}
        </p>
        <p className="small">
          {cp.requester}: {proposal.requesterNameSnapshot} ({proposal.requesterRoleSnapshot})
        </p>
        <p className="small">
          {cp.section}: {proposal.section}
        </p>
        <p>
          <strong>{cp.requirement}</strong>
          <br />
          {proposal.requirement}
        </p>
        <p>
          <strong>{cp.reason}</strong>
          <br />
          {proposal.reason}
        </p>
        <p className="small">
          {cp.proofType}: {proposal.proofType} · {cp.assignedRole}: {proposal.assignedRole} ·{' '}
          {cp.failureCategory}: {proposal.failureCategory} ·{' '}
          {proposal.required ? cp.required : cp.optional}
          {proposal.completionTime ? ` · ${cp.completionTime}: ${proposal.completionTime}` : ''}
        </p>
        {proposal.firstApproverUserId && (
          <p className="small">
            {cp.firstApprover}: {proposal.firstApproverRole} · {proposal.firstApprovalComment}
          </p>
        )}
        {proposal.finalApproverUserId && (
          <p className="small">
            {cp.finalApprover}: {proposal.finalApproverRole} · {proposal.finalApprovalComment}
          </p>
        )}
        {proposal.resultingTemplateItemId && (
          <p className="small">
            {cp.publishedItemId}: {proposal.resultingTemplateItemId}
            <br />
            {cp.publishedAt}: {proposal.publishedAt}
          </p>
        )}
      </div>

      <div className="card">
        <h3>{cp.timeline}</h3>
        {events.length === 0 && <p className="small">{t.common.noData}</p>}
        {events.map((ev) => (
          <div key={ev.id} className="item-card" style={{ marginTop: 6 }}>
            <strong>{ev.eventType}</strong>
            <div className="small">
              {ev.fromStatus || '—'} → {statusLabel(ev.toStatus || ev.fromStatus)} · {ev.createdAt}
            </div>
          </div>
        ))}
      </div>

      {(canActorFirstApprove(profile, proposal, defs) ||
        canActorFinalApprove(profile, proposal, defs) ||
        canActorPublish(profile, proposal, defs) ||
        canActorEditProposal(profile, proposal, defs) ||
        (proposal.requestedByUserId === profile.userId &&
          ['draft', 'pending_first_approval', 'changes_requested'].includes(proposal.status))) && (
        <div className="card">
          <label>
            {cp.approvalComment}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {canActorFirstApprove(profile, proposal, defs) && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      firstApproveChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        comment,
                      }),
                    )
                  }
                >
                  {cp.approveFirst}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      requestChangesChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        comment,
                        level: 'first',
                      }),
                    )
                  }
                >
                  {cp.requestChanges}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      rejectChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        reason: comment,
                        level: 'first',
                      }),
                    )
                  }
                >
                  {cp.reject}
                </button>
              </>
            )}
            {canActorFinalApprove(profile, proposal, defs) && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      finalApproveChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        comment,
                      }),
                    )
                  }
                >
                  {cp.approveFinal}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      requestChangesChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        comment,
                        level: 'final',
                      }),
                    )
                  }
                >
                  {cp.requestChanges}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      rejectChecklistItemProposal({
                        proposal,
                        actor: profile,
                        defs,
                        reason: comment,
                        level: 'final',
                      }),
                    )
                  }
                >
                  {cp.reject}
                </button>
              </>
            )}
            {canActorPublish(profile, proposal, defs) && template && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    publishApprovedChecklistItemProposal({
                      proposal,
                      publisher: profile,
                      defs,
                      template,
                      existingProposals,
                    }).then(() => undefined),
                  )
                }
              >
                {cp.publish}
              </button>
            )}
            {canActorEditProposal(profile, proposal, defs) && template && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    submitChecklistItemProposal({
                      proposal,
                      actor: profile,
                      defs,
                      template,
                      profiles: allProfiles,
                      existingProposals: [],
                    }),
                  )
                }
              >
                {cp.resubmit}
              </button>
            )}
            {proposal.requestedByUserId === profile.userId &&
              ['draft', 'pending_first_approval', 'changes_requested'].includes(proposal.status) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      cancelChecklistItemProposal({ proposal, actor: profile, defs }),
                    )
                  }
                >
                  {cp.cancelProposal}
                </button>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
