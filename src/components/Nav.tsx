import { db } from '../db';
import {
  canAccessChecklistItemProposals,
  canAccessUsersPage,
  canEditMaster,
  canReview,
  canScheduleShifts,
  canUseOpsTools,
} from '../lib/roles';
import { isLogbookIssue, resolveLogbookIssueStatus } from '../lib/logbook';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import LanguageSelector from './LanguageSelector';
import ProfileAvatar from './profileAvatar/ProfileAvatar';
import { useUnreadNotificationCount } from './FeedbackInbox';
import type { LogbookEntry, Profile } from '../types';

export type Page =
  | 'home' | 'submit' | 'review' | 'profile'
  | 'stores' | 'users' | 'templates' | 'proposals' | 'proposalForm'
  | 'corrective'
  | 'photos' | 'verify' | 'shifts' | 'logbook';

interface NavProps {
  page: Page;
  setPage: (p: Page) => void;
  profile: Profile;
  onOpenLogbook?: () => void;
}

export function DesktopNav({ page, setPage, profile, onOpenLogbook }: NavProps) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();

  const { data: logbookData } = db.useQuery({
    logbookEntries: {},
  });
  const assignedIssueExists = ((logbookData?.logbookEntries ?? []) as LogbookEntry[]).some(
    (e) =>
      isLogbookIssue(e) &&
      resolveLogbookIssueStatus(e) !== 'resolved' &&
      e.assigneeRole === profile.role &&
      (profile.stores ?? []).some((s) => s.id === e.storeId),
  );

  const showLogbook = canUseOpsTools(profile.role, defs) || assignedIssueExists;

  const links: { id: Page; label: string }[] = [
    { id: 'home',    label: t.nav.dashboard },
    { id: 'submit',  label: t.nav.submit },
  ];

  if (canReview(profile.role, defs)) {
    links.push({ id: 'review', label: t.nav.review });
  }

  if (canEditMaster(profile.role, defs)) {
    links.push({ id: 'templates', label: t.nav.templates });
    links.push({ id: 'stores',    label: t.nav.stores });
  }
  if (canAccessChecklistItemProposals(profile.role, defs)) {
    links.push({ id: 'proposals', label: t.nav.proposals });
  }
  if (canAccessUsersPage(profile.role, defs)) {
    links.push({ id: 'users', label: t.nav.users });
  }
  if (canUseOpsTools(profile.role, defs)) {
    links.push({ id: 'corrective', label: t.nav.corrective });
    links.push({ id: 'photos',     label: t.nav.photos });
    links.push({ id: 'verify',     label: t.nav.verify });
  }
  if (showLogbook) {
    links.push({ id: 'logbook', label: t.nav.logbook });
  }
  if (canScheduleShifts(profile.role, defs) || canReview(profile.role, defs)) {
    links.push({ id: 'shifts', label: t.nav.shifts });
  }

  return (
    <div className="nav-top desktop-nav" style={{ alignItems: 'center' }}>
      {links.map((l) => (
        <button
          key={l.id}
          className={page === l.id || (l.id === 'proposals' && page === 'proposalForm') ? 'active' : ''}
          onClick={() => {
            if (l.id === 'logbook' && onOpenLogbook) onOpenLogbook();
            else setPage(l.id);
          }}
        >
          {l.label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className={`nav-profile-btn${page === 'profile' ? ' active' : ''}`}
        onClick={() => setPage('profile')}
        aria-label={t.nav.profile}
      >
        <ProfileAvatar profile={profile} size={32} />
      </button>

      <LanguageSelector />

      <button className="secondary" onClick={() => db.auth.signOut()}>
        {t.nav.signOut}
      </button>
    </div>
  );
}

export function MobileNav({ page, setPage, profile }: NavProps) {
  const { t } = useLang();
  const unreadCount = useUnreadNotificationCount(profile.userId);

  const tabs: { id: Page; label: string }[] = [
    { id: 'home',    label: t.nav.dashboard },
    { id: 'submit',  label: t.nav.submit },
    { id: 'review',  label: t.nav.review },
    { id: 'profile', label: t.nav.profile },
  ];

  return (
    <>
      <div className="mobile-lang-row">
        <LanguageSelector />
      </div>
      <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={page === tab.id ? 'active' : ''}
          onClick={() => setPage(tab.id)}
        >
          <span className="nav-tab-label">
            {tab.id === 'profile' ? (
              <span className="nav-tab-avatar">
                <ProfileAvatar profile={profile} size={22} />
                <span>{tab.label}</span>
              </span>
            ) : (
              tab.label
            )}
            {tab.id === 'home' && unreadCount > 0 && (
              <span className="nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </span>
        </button>
      ))}
    </nav>
    </>
  );
}
