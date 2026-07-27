import { useEffect, useMemo, useState } from 'react';
import AckDetailsDropdown from './AckDetailsDropdown';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import {
  isStaffOrHybrid,
  parseLogbookAckUserIds,
  resolveLogbookEntryType,
  splitNotesAnnouncementsForHome,
} from '../lib/logbook';
import { nowIso } from '../lib/utils';
import type { LogbookEntry, Profile } from '../types';

interface Props {
  profile: Profile;
  entries: LogbookEntry[];
  highlightEntryId?: string | null;
  onHighlightConsumed?: () => void;
}

export default function NotesAnnouncementsCard({
  profile,
  entries,
  highlightEntryId,
  onHighlightConsumed,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: profilesData } = db.useQuery({
    profiles: { stores: {} },
  });
  const allProfiles = (profilesData?.profiles ?? []) as Profile[];

  const { pending, acknowledgedByMe } = useMemo(
    () => splitNotesAnnouncementsForHome(profile, entries, defs),
    [profile, entries, defs],
  );

  useEffect(() => {
    if (!highlightEntryId) return;
    const el = document.getElementById(`notes-announcement-${highlightEntryId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (acknowledgedByMe.some((e) => e.id === highlightEntryId)) {
        setHistoryOpen(true);
      }
    }
    const timer = window.setTimeout(() => {
      onHighlightConsumed?.();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [highlightEntryId, acknowledgedByMe, onHighlightConsumed]);

  if (!isStaffOrHybrid(profile.role)) return null;
  if (!pending.length && !acknowledgedByMe.length) return null;

  async function acknowledge(entry: LogbookEntry) {
    if (!entry.requiresAck) return;
    const current = parseLogbookAckUserIds(entry.ackUserIdsJson);
    if (current.includes(profile.userId)) return;
    const updated = [...current, profile.userId];
    await db.transact(
      db.tx.logbookEntries[entry.id].update({
        ackUserIdsJson: JSON.stringify(updated),
        updatedAt: nowIso(),
      }),
    );
  }

  function renderEntry(entry: LogbookEntry, acked: boolean) {
    const type = resolveLogbookEntryType(entry);
    const highlighted = highlightEntryId === entry.id;
    const entryStore = entry.store;

    return (
      <div
        key={entry.id}
        id={`notes-announcement-${entry.id}`}
        className="item-card"
        style={{
          marginTop: 8,
          ...(highlighted ? { outline: '2px solid var(--accent, #2563eb)' } : undefined),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge">
            {type === 'announcement' ? t.logbook.typeAnnouncement : t.logbook.typeNote}
          </span>
          <span
            className={`badge ${
              entry.severity === 'critical'
                ? 'severity-critical'
                : entry.severity === 'warning'
                  ? 'severity-warning'
                  : 'severity-info'
            }`}
          >
            {entry.severity}
          </span>
          {entryStore && (
            <span className="small">
              {entryStore.code}
              {entryStore.name ? ` — ${entryStore.name}` : ''}
            </span>
          )}
          {!entryStore && !entry.storeId && (
            <span className="small">{t.staffHome.notesAllStores}</span>
          )}
        </div>
        <p style={{ margin: '8px 0 0' }}>{entry.content}</p>
        <div style={{ marginTop: 8 }}>
          {acked ? (
            <span className="badge good">{t.common.acknowledged}</span>
          ) : (
            <button
              type="button"
              className="secondary"
              style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
              onClick={() => void acknowledge(entry)}
            >
              {t.common.acknowledge}
            </button>
          )}
          <AckDetailsDropdown
            ackUserIdsJson={entry.ackUserIdsJson}
            profiles={allProfiles}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{t.staffHome.notesAnnouncements}</h2>
        {pending.length > 0 && <span className="badge warn">{pending.length}</span>}
      </div>
      <p className="small">{t.staffHome.notesAnnouncementsHint}</p>

      {pending.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>{t.staffHome.notesPending}</h3>
          {pending.map((e) => renderEntry(e, false))}
        </div>
      ) : (
        <p className="small" style={{ marginTop: 8 }}>
          {t.staffHome.notesNonePending}
        </p>
      )}

      {acknowledgedByMe.length > 0 && (
        <details
          style={{ marginTop: 12 }}
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary style={{ cursor: 'pointer' }}>
            {t.staffHome.notesAcknowledgedHistory} ({acknowledgedByMe.length})
          </summary>
          {acknowledgedByMe.map((e) => renderEntry(e, true))}
        </details>
      )}
    </div>
  );
}
