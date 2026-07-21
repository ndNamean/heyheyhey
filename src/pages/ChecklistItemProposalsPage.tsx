import { useMemo, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  canAccessChecklistItemProposals,
  canProposeTemplateItem,
} from '../lib/roles';
import {
  canActorFinalApprove,
  canActorFirstApprove,
  canActorPublish,
  filterProposalsForViewer,
  parseStoreIdsJson,
} from '../lib/checklistItemProposals';
import { badgeClass } from '../lib/utils';
import type { ChecklistItemProposal, Profile, Store } from '../types';
import ChecklistItemProposalDetail from '../components/ChecklistItemProposalDetail';

interface Props {
  profile: Profile;
  onNewProposal: () => void;
  selectedProposalId?: string | null;
  onSelectProposal: (id: string | null) => void;
}

type Tab = 'mine' | 'first' | 'final' | 'publish' | 'all';

export default function ChecklistItemProposalsPage({
  profile,
  onNewProposal,
  selectedProposalId,
  onSelectProposal,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [tab, setTab] = useState<Tab>('mine');

  const { data, isLoading } = db.useQuery({
    checklistItemProposals: {
      comments: {},
      events: {},
      sourceStore: {},
      template: { items: {}, stores: {} },
    },
    profiles: { stores: {} },
    stores: {},
  });

  const allProposals = (data?.checklistItemProposals ?? []) as ChecklistItemProposal[];
  const visible = useMemo(
    () => filterProposalsForViewer(allProposals, profile, defs),
    [allProposals, profile, defs],
  );
  const storesById = useMemo(() => {
    const map = new Map<string, Store>();
    for (const s of (data?.stores ?? []) as Store[]) map.set(s.id, s);
    return map;
  }, [data?.stores]);

  if (!canAccessChecklistItemProposals(profile.role, defs)) {
    return <div className="card">{t.checklistProposals.noPermission}</div>;
  }

  if (selectedProposalId) {
    const proposal = visible.find((p) => p.id === selectedProposalId) ?? null;
    if (!proposal) {
      return (
        <div className="card">
          <p>{t.common.noData}</p>
          <button type="button" className="secondary" onClick={() => onSelectProposal(null)}>
            {t.common.back}
          </button>
        </div>
      );
    }
    return (
      <ChecklistItemProposalDetail
        profile={profile}
        proposal={proposal}
        allProfiles={(data?.profiles ?? []) as Profile[]}
        existingProposals={allProposals}
        onBack={() => onSelectProposal(null)}
      />
    );
  }

  const filtered = visible.filter((p) => {
    if (tab === 'mine') return p.requestedByUserId === profile.userId;
    if (tab === 'first') return canActorFirstApprove(profile, p, defs);
    if (tab === 'final') return canActorFinalApprove(profile, p, defs);
    if (tab === 'publish') return canActorPublish(profile, p, defs);
    return true;
  });

  function statusLabel(status: string): string {
    const map = t.checklistProposals.statuses as Record<string, string>;
    return map[status] ?? status;
  }

  function storeLabel(storeId: string): string {
    const s = storesById.get(storeId);
    return s ? `${s.code}` : storeId.slice(0, 8);
  }

  return (
    <div>
      <div className="card">
        <h1>{t.checklistProposals.title}</h1>
        <p className="small">{t.checklistProposals.subtitle}</p>
        {canProposeTemplateItem(profile.role, defs) && (
          <button type="button" style={{ marginTop: 8 }} onClick={onNewProposal}>
            {t.checklistProposals.newProposal}
          </button>
        )}
        <div className="tabs" style={{ marginTop: 12 }}>
          {(
            [
              ['mine', t.checklistProposals.myProposals],
              ['first', t.checklistProposals.firstApprovalQueue],
              ['final', t.checklistProposals.finalApprovalQueue],
              ['publish', t.checklistProposals.publishQueue],
              ['all', t.checklistProposals.allProposals],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="card">{t.common.loading}</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="card">
          <p className="small">{t.checklistProposals.noProposals}</p>
        </div>
      )}

      {filtered.map((p) => {
        const affected = parseStoreIdsJson(p.affectedStoreIdsJson);
        return (
          <div className="card" key={p.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, flex: 1 }}>{p.title}</h2>
              <span className={badgeClass(p.status)}>{statusLabel(p.status)}</span>
            </div>
            <p className="small">
              {p.section} · {p.templateNameSnapshot}
            </p>
            <p className="small">
              {t.checklistProposals.requester}: {p.requesterNameSnapshot} ({p.requesterRoleSnapshot}) ·{' '}
              {storeLabel(p.requesterStoreId || p.sourceStoreId)}
            </p>
            <p className="small">
              {t.checklistProposals.storeScopeNote}
              {affected.length ? ` (${affected.map(storeLabel).join(', ')})` : ''}
            </p>
            <button type="button" style={{ marginTop: 8 }} onClick={() => onSelectProposal(p.id)}>
              {t.checklistProposals.open}
            </button>
          </div>
        );
      })}
    </div>
  );
}
