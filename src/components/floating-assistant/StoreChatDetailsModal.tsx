import { useEffect, useMemo } from 'react';
import { db } from '../../db';
import { buildStoreChatRoomMembers } from '../../lib/storeChatMentions';
import type { Profile, Store } from '../../types';
import IdentityWithAvatar from '../profileAvatar/IdentityWithAvatar';

interface Props {
  open: boolean;
  onClose: () => void;
  store: Store | null;
}

export default function StoreChatDetailsModal({ open, onClose, store }: Props) {
  const storeId = open && store ? store.id : '';

  const { data, isLoading } = db.useQuery(
    storeId
      ? {
          profiles: {
            $: { where: { approvalStatus: 'approved' } },
            stores: {},
            avatarFile: {},
          },
        }
      : null,
  );

  const members = useMemo(() => {
    if (!storeId) return [];
    return buildStoreChatRoomMembers((data?.profiles ?? []) as Profile[], storeId);
  }, [data?.profiles, storeId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !store) return null;

  const title = `${store.code} · ${store.name}`;

  return (
    <div className="fa-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fa-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Store details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fa-modal-header">
          <h3>{title}</h3>
          <button type="button" className="fa-panel-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="fa-modal-body">
          <p className="small">
            Store chat · {isLoading ? '…' : `${members.length} member${members.length === 1 ? '' : 's'}`}
          </p>
          <h4 className="fa-group-members-heading">Members</h4>
          {isLoading ? (
            <p className="small">Loading members…</p>
          ) : (
            <ul className="fa-group-members-list">
              {members.map((m) => (
                <li key={m.userId} className="fa-group-member-row">
                  <span className="fa-group-member-identity">
                    <IdentityWithAvatar profile={m.profile} size={20}>
                      {m.label} · {m.role}
                    </IdentityWithAvatar>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
