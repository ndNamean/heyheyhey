import { useEffect, useMemo, useRef } from 'react';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { useLang } from '../i18n';
import { parseLogbookAckUserIds, resolveLogbookAckPeople } from '../lib/logbook';
import type { Profile } from '../types';

interface Props {
  ackUserIdsJson: string;
  profiles: Profile[];
}

const HOST_OPEN_CLASS = 'ack-details-host-open';

function closestHost(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  return el.closest('.card, .item-card') as HTMLElement | null;
}

export default function AckDetailsDropdown({ ackUserIdsJson, profiles }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const hostRef = useRef<HTMLElement | null>(null);

  const ackCount = useMemo(
    () => parseLogbookAckUserIds(ackUserIdsJson).length,
    [ackUserIdsJson],
  );
  const people = useMemo(
    () => resolveLogbookAckPeople({ ackUserIdsJson }, profiles, defs),
    [ackUserIdsJson, profiles, defs],
  );

  function setHostOpen(open: boolean) {
    const host = hostRef.current ?? closestHost(detailsRef.current);
    hostRef.current = host;
    if (!host) return;
    host.classList.toggle(HOST_OPEN_CLASS, open);
  }

  useEffect(() => {
    hostRef.current = closestHost(detailsRef.current);
    function close() {
      if (detailsRef.current) detailsRef.current.open = false;
      setHostOpen(false);
    }
    function handlePointerDown(e: PointerEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    // pointerdown avoids racing the summary click that opens <details>
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      setHostOpen(false);
    };
  }, []);

  const countLabel = `${ackCount} ${ackCount !== 1 ? t.logbook.acks : t.logbook.ack}`;

  return (
    <details
      ref={detailsRef}
      className="ack-details"
      onToggle={(e) => {
        setHostOpen((e.target as HTMLDetailsElement).open);
      }}
    >
      <summary className="ack-details-trigger small" aria-haspopup="listbox">
        <span>{countLabel}</span>
        <span className="ack-details-chevron" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="dropdown-panel dropdown-panel--below ack-details-panel" role="list">
        <div className="ack-details-title">{t.logbook.ackDetails}</div>
        {people.length === 0 ? (
          <div className="ack-details-empty">{t.logbook.noAcksYet}</div>
        ) : (
          people.map((person) => (
            <div key={person.userId} className="ack-details-row" role="listitem">
              <span className="ack-details-name">
                {person.displayName}
                {(person.storeCodesLabel || person.allStores) && (
                  <span className="ack-details-stores">
                    {' · '}
                    {person.allStores ? t.logbook.ackAllStores : person.storeCodesLabel}
                  </span>
                )}
              </span>
              <span className="ack-details-role">{person.role}</span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
