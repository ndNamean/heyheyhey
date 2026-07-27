import { useEffect, useMemo, useRef } from 'react';
import { useLang } from '../i18n';
import { parseLogbookAckUserIds, resolveLogbookAckPeople } from '../lib/logbook';
import type { Profile } from '../types';

interface Props {
  ackUserIdsJson: string;
  profiles: Profile[];
}

export default function AckDetailsDropdown({ ackUserIdsJson, profiles }: Props) {
  const { t } = useLang();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const ackCount = useMemo(
    () => parseLogbookAckUserIds(ackUserIdsJson).length,
    [ackUserIdsJson],
  );
  const people = useMemo(
    () => resolveLogbookAckPeople({ ackUserIdsJson }, profiles),
    [ackUserIdsJson, profiles],
  );

  useEffect(() => {
    function close() {
      if (detailsRef.current) detailsRef.current.open = false;
    }
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const countLabel = `${ackCount} ${ackCount !== 1 ? t.logbook.acks : t.logbook.ack}`;

  return (
    <details ref={detailsRef} className="ack-details">
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
              <span className="ack-details-name">{person.displayName}</span>
              <span className="ack-details-role">{person.role}</span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
