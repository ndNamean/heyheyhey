import { db } from '../db';
import { canEditMaster, canReview } from '../lib/roles';
import { useLang } from '../i18n';
import LanguageSelector from './LanguageSelector';
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

function canManageUsers(role: string): boolean {
  return role === 'owner' || role === 'areaManager';
}

export function DesktopNav({ page, setPage, profile }: NavProps) {
  const { t } = useLang();

  const links: { id: Page; label: string }[] = [
    { id: 'home',    label: t.nav.dashboard },
    { id: 'submit',  label: t.nav.submit },
    { id: 'review',  label: t.nav.review },
  ];

  if (canEditMaster(profile.role)) {
    links.push({ id: 'templates', label: t.nav.templates });
    links.push({ id: 'stores',    label: t.nav.stores });
  }
  if (canManageUsers(profile.role)) {
    links.push({ id: 'users', label: t.nav.users });
  }
  if (canReview(profile.role)) {
    links.push({ id: 'corrective', label: t.nav.corrective });
    links.push({ id: 'photos',     label: t.nav.photos });
    links.push({ id: 'verify',     label: t.nav.verify });
    links.push({ id: 'shifts',     label: t.nav.shifts });
    links.push({ id: 'logbook',    label: t.nav.logbook });
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

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Language selector */}
      <LanguageSelector />

      <button className="secondary" onClick={() => db.auth.signOut()}>
        {t.nav.signOut}
      </button>
    </div>
  );
}

export function MobileNav({ page, setPage, profile }: NavProps) {
  const { t } = useLang();

  const tabs: { id: Page; label: string }[] = [
    { id: 'home',    label: t.nav.dashboard },
    { id: 'submit',  label: t.nav.submit },
    { id: 'review',  label: t.nav.review },
    { id: 'profile', label: t.nav.profile },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={page === tab.id ? 'active' : ''}
          onClick={() => setPage(tab.id)}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export type { Page };
