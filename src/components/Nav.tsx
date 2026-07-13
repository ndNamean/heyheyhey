import { db } from '../db';
import {
  canAccessUsersPage,
  canEditMaster,
  canReview,
  canScheduleShifts,
  canUseOpsTools,
} from '../lib/roles';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import LanguageSelector from './LanguageSelector';
import { useUnreadNotificationCount } from './FeedbackInbox';
import type { Profile } from '../types';

type Page =
  | 'home' | 'submit' | 'review' | 'profile'
  | 'stores' | 'users' | 'templates' | 'corrective'
  | 'photos' | 'verify' | 'shifts' | 'logbook';

interface NavProps {
  page: Page;
  setPage: (p: Page) => void;
  profile: Profile;
}

export function DesktopNav({ page, setPage, profile }: NavProps) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();

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
  if (canAccessUsersPage(profile.role, defs)) {
    links.push({ id: 'users', label: t.nav.users });
  }
  if (canUseOpsTools(profile.role, defs)) {
    links.push({ id: 'corrective', label: t.nav.corrective });
    links.push({ id: 'photos',     label: t.nav.photos });
    links.push({ id: 'verify',     label: t.nav.verify });
    links.push({ id: 'logbook',    label: t.nav.logbook });
  }
  if (canScheduleShifts(profile.role, defs) || canReview(profile.role, defs)) {
    links.push({ id: 'shifts', label: t.nav.shifts });
  }

  return (
    <div className="nav-top desktop-nav" style={{ alignItems: 'center' }}>
      {links.map((l) => (
        <button
          key={l.id}
          className={page === l.id ? 'active' : ''}
          onClick={() => setPage(l.id)}
        >
          {l.label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

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
            {tab.label}
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

export type { Page };
