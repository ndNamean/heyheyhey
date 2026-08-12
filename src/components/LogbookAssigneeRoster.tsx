import IdentityWithAvatar from './profileAvatar/IdentityWithAvatar';
import { badgeClass } from '../lib/utils';
import {
  LOGBOOK_ASSIGNEE_ROSTER_VISIBLE_CAP,
  buildLogbookAssigneeRoster,
  isLogbookAssigneeRosterRoleWide,
  type AssigneeRosterState,
  type LogbookAssigneeRosterEntry,
} from '../lib/logbookAssigneeRoster';
import type { Profile, RoleDefinition } from '../types';

export type LogbookAssigneeRosterCopy = {
  assigneeNotSubmitted: string;
  assigneeSubmitted: string;
  assigneeWaitingApproval: string;
  assigneeCorrection: string;
  assigneeApproved: string;
  assigneeRosterSummary: string;
};

function rosterBadgeClass(state: AssigneeRosterState): string {
  if (state === 'approved') return badgeClass('approved');
  if (state === 'waiting_approval') return badgeClass('waiting_approval');
  if (state === 'correction') return badgeClass('need_correction');
  if (state === 'submitted') return badgeClass('pending');
  return 'badge';
}

function rosterStateLabel(state: AssigneeRosterState, copy: LogbookAssigneeRosterCopy): string {
  if (state === 'waiting_approval') return copy.assigneeWaitingApproval;
  if (state === 'correction') return copy.assigneeCorrection;
  if (state === 'approved') return copy.assigneeApproved;
  if (state === 'submitted') return copy.assigneeSubmitted;
  return copy.assigneeNotSubmitted;
}

type Props = {
  entry: LogbookAssigneeRosterEntry;
  profiles: Profile[];
  defs?: RoleDefinition[];
  copy: LogbookAssigneeRosterCopy;
  testId?: string;
};

export default function LogbookAssigneeRoster({
  entry,
  profiles,
  defs,
  copy,
  testId = 'logbook-assignee-roster',
}: Props) {
  const rows = buildLogbookAssigneeRoster(entry, profiles, defs);
  if (rows.length === 0) return null;

  const done = rows.filter((r) => r.state !== 'not_submitted').length;
  const total = rows.length;
  const roleWide = isLogbookAssigneeRosterRoleWide(entry);
  const capped = roleWide && total > LOGBOOK_ASSIGNEE_ROSTER_VISIBLE_CAP;
  const visible = capped ? rows.slice(0, LOGBOOK_ASSIGNEE_ROSTER_VISIBLE_CAP) : rows;
  const more = capped ? total - LOGBOOK_ASSIGNEE_ROSTER_VISIBLE_CAP : 0;
  const showSummary = total > 1 || done > 0;

  return (
    <span
      data-testid={testId}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, verticalAlign: 'top' }}
    >
      {showSummary ? (
        <span className="small" data-testid={`${testId}-summary`}>
          {copy.assigneeRosterSummary
            .replace('{done}', String(done))
            .replace('{total}', String(total))}
        </span>
      ) : null}
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {visible.map((row) => (
          <span
            key={row.userId}
            data-testid={`${testId}-row`}
            data-user-id={row.userId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <IdentityWithAvatar profile={row.profile}>{row.label}</IdentityWithAvatar>
            <span className={rosterBadgeClass(row.state)} data-testid={`${testId}-state-${row.userId}`}>
              {rosterStateLabel(row.state, copy)}
            </span>
          </span>
        ))}
        {more > 0 ? (
          <span className="small" data-testid={`${testId}-more`}>
            +{more}
          </span>
        ) : null}
      </span>
    </span>
  );
}
