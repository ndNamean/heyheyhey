import { useMemo, useState, type FormEvent } from 'react';
import { db } from '../../db';
import { groupChatApi } from '../../lib/groupChatApi';
import {
  validateGroupChatName,
  normalizeGroupChatDescription,
  similarNameKey,
} from '../../lib/groupChatValidation';
import type { Profile, Store } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  authorizedStores: Store[];
  canCrossStore: boolean;
  existingGroupNames: string[];
  onCreated: (roomId: string) => void;
}

export default function CreateGroupModal({
  open,
  onClose,
  profile,
  authorizedStores,
  canCrossStore,
  existingGroupNames,
  onCreated,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = db.useQuery(
    open
      ? {
          profiles: {
            $: { where: { approvalStatus: 'approved' } },
            stores: {},
          },
        }
      : null,
  );

  const authorizedStoreIds = useMemo(
    () => new Set(authorizedStores.map((s) => s.id)),
    [authorizedStores],
  );

  const candidates = useMemo(() => {
    const profiles = (data?.profiles ?? []) as Profile[];
    const needle = search.trim().toLowerCase();
    return profiles
      .filter((p) => p.id !== profile.id && p.userId !== profile.userId)
      .map((p) => {
        const storeIds = (p.stores ?? []).map((s) => s.id);
        const overlap = storeIds.some((id) => authorizedStoreIds.has(id));
        const cross = !overlap;
        const disabled = cross && !canCrossStore;
        const reason = disabled
          ? 'Outside your stores (needs cross-store capability)'
          : cross
            ? 'Cross-store'
            : '';
        const label = p.displayName || p.email || p.id;
        const hay = `${label} ${p.role} ${storeIds.join(' ')}`.toLowerCase();
        const matches = !needle || hay.includes(needle);
        return { profile: p, label, disabled, reason, cross, matches };
      })
      .filter((c) => c.matches)
      .slice(0, 80);
  }, [data?.profiles, profile.id, profile.userId, authorizedStoreIds, canCrossStore, search]);

  const similarWarn = useMemo(() => {
    const key = similarNameKey(name);
    if (!key) return null;
    const hit = existingGroupNames.find((n) => similarNameKey(n) === key);
    return hit || null;
  }, [name, existingGroupNames]);

  if (!open) return null;

  function resetAndClose() {
    setStep(1);
    setName('');
    setDescription('');
    setSelectedIds([]);
    setSearch('');
    setError(null);
    setBusy(false);
    onClose();
  }

  function toggleId(id: string, disabled: boolean) {
    if (disabled) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const check = validateGroupChatName(name);
    if (!check.ok) {
      setError(`Invalid name (${check.error})`);
      setStep(1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await groupChatApi<{ roomId: string }>('groupChatCreate', {
        name: check.name,
        description: normalizeGroupChatDescription(description),
        inviteeProfileIds: selectedIds,
      });
      onCreated(res.roomId);
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fa-modal-backdrop" role="presentation" onClick={resetAndClose}>
      <div
        className="fa-modal fa-create-group-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fa-create-group-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fa-modal-header">
          <h3 id="fa-create-group-title">New private group</h3>
          <button type="button" className="fa-panel-close" aria-label="Close" onClick={resetAndClose}>
            ×
          </button>
        </header>

        <form onSubmit={onSubmit} className="fa-modal-body">
          <p className="fa-create-group-disclosure small">
            Private invite-accept group. Only accepted members can open it. After accept, members
            see the full message history.
          </p>

          {step === 1 ? (
            <div className="fa-create-group-step">
              <label className="fa-field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  autoFocus
                />
              </label>
              {similarWarn ? (
                <p className="fa-create-group-warn small">Similar to existing group “{similarWarn}”.</p>
              ) : null}
              <label className="fa-field">
                <span>Description (optional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                  rows={3}
                />
              </label>
              <div className="fa-modal-actions">
                <button type="button" className="fa-btn-secondary" onClick={resetAndClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="fa-btn-primary"
                  onClick={() => {
                    const check = validateGroupChatName(name);
                    if (!check.ok) {
                      setError(`Invalid name (${check.error})`);
                      return;
                    }
                    setError(null);
                    setStep(2);
                  }}
                >
                  Next: invite members
                </button>
              </div>
            </div>
          ) : (
            <div className="fa-create-group-step">
              <p className="small">
                You are the owner. Selected people receive invites (not auto-joined).
              </p>
              <label className="fa-field">
                <span>Search people</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, role, store…"
                  autoFocus
                />
              </label>
              <ul className="fa-create-group-picker" aria-label="Invite candidates">
                {candidates.map((c) => {
                  const checked = selectedIds.includes(c.profile.id);
                  return (
                    <li key={c.profile.id}>
                      <label
                        className={`fa-create-group-pick${c.disabled ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={c.disabled}
                          onChange={() => toggleId(c.profile.id, c.disabled)}
                        />
                        <span>
                          <strong>{c.label}</strong>
                          <span className="small">
                            {' '}
                            · {c.profile.role}
                            {c.reason ? ` · ${c.reason}` : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="small" aria-live="polite">
                {selectedIds.length} selected
              </p>
              <div className="fa-modal-actions">
                <button type="button" className="fa-btn-secondary" onClick={() => setStep(1)}>
                  Back
                </button>
                <button type="submit" className="fa-btn-primary" disabled={busy}>
                  {busy ? 'Creating…' : 'Create group'}
                </button>
              </div>
            </div>
          )}

          {error ? (
            <p className="fa-create-group-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
