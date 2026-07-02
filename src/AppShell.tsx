import { useState } from 'react';
import { DesktopNav, MobileNav, type Page } from './components/Nav';
import StaffHome from './pages/StaffHome';
import DashboardPage from './pages/DashboardPage';
import SubmitReportPage from './pages/SubmitReportPage';
import ReviewPage from './pages/ReviewPage';
import ProfilePage from './pages/ProfilePage';
import StoresPage from './pages/StoresPage';
import UsersPage from './pages/UsersPage';
import TemplatesPage from './pages/TemplatesPage';
import CorrectiveActionsPage from './pages/CorrectiveActionsPage';
import PhotoSheetPage from './pages/PhotoSheetPage';
import VerifyPhotoPage from './pages/VerifyPhotoPage';
import ShiftsPage from './pages/ShiftsPage';
import LogbookPage from './pages/LogbookPage';
import type { Profile } from './types';

interface Props {
  profile: Profile;
}

export default function AppShell({ profile }: Props) {
  const [page, setPage] = useState<Page>('home');

  function renderPage() {
    switch (page) {
      case 'home':
        return profile.role === 'owner' || profile.role === 'areaManager' ? (
          <DashboardPage profile={profile} />
        ) : (
          <StaffHome profile={profile} setPage={setPage} />
        );
      case 'submit':
        return <SubmitReportPage profile={profile} />;
      case 'review':
        return <ReviewPage profile={profile} />;
      case 'profile':
        return <ProfilePage profile={profile} />;
      case 'stores':
        return <StoresPage profile={profile} />;
      case 'users':
        return <UsersPage currentProfile={profile} />;
      case 'templates':
        return <TemplatesPage profile={profile} />;
      case 'corrective':
        return <CorrectiveActionsPage profile={profile} />;
      case 'photos':
        return <PhotoSheetPage profile={profile} />;
      case 'verify':
        return <VerifyPhotoPage profile={profile} />;
      case 'shifts':
        return <ShiftsPage profile={profile} />;
      case 'logbook':
        return <LogbookPage profile={profile} />;
      default:
        return <StaffHome profile={profile} setPage={setPage} />;
    }
  }

  return (
    <main className="page">
      <DesktopNav page={page} setPage={setPage} profile={profile} />
      {renderPage()}
      <MobileNav page={page} setPage={setPage} profile={profile} />
    </main>
  );
}
