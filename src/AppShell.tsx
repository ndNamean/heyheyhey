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
import { useRoleDefinitions } from './contexts/RoleDefinitionsContext';
import { usesDashboardHome } from './lib/roles';
import { BACK_PRIORITY, useNativeBack } from './lib/nativeBack';
import type { Profile } from './types';

interface Props {
  profile: Profile;
}

export default function AppShell({ profile }: Props) {
  const { defs } = useRoleDefinitions();
  const [page, setPage] = useState<Page>('home');
  const [correctionReportId, setCorrectionReportId] = useState<string | null>(null);

  useNativeBack(
    () => {
      if (page === 'home') return false;
      setCorrectionReportId(null);
      setPage('home');
      return true;
    },
    page !== 'home',
    BACK_PRIORITY.PAGE,
  );

  function startNewReport() {
    setCorrectionReportId(null);
    setPage('submit');
  }

  function startCorrection(reportId: string) {
    setCorrectionReportId(reportId);
    setPage('submit');
  }

  function renderPage() {
    switch (page) {
      case 'home':
        return usesDashboardHome(profile.role, defs) ? (
          <DashboardPage profile={profile} />
        ) : (
          <StaffHome
            profile={profile}
            setPage={setPage}
            onStartReport={startNewReport}
            onFixReport={startCorrection}
          />
        );
      case 'submit':
        return (
          <SubmitReportPage
            profile={profile}
            correctionReportId={correctionReportId}
            onCorrectionComplete={() => {
              setCorrectionReportId(null);
              setPage('home');
            }}
          />
        );
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
        return (
          <StaffHome
            profile={profile}
            setPage={setPage}
            onStartReport={startNewReport}
            onFixReport={startCorrection}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      <main className="page">
        <DesktopNav page={page} setPage={setPage} profile={profile} />
        {renderPage()}
        <MobileNav page={page} setPage={setPage} profile={profile} />
      </main>
    </div>
  );
}
