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
import ChecklistItemProposalsPage from './pages/ChecklistItemProposalsPage';
import ChecklistItemProposalFormPage, {
  type ProposalFormPrefill,
} from './pages/ChecklistItemProposalFormPage';
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
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [proposalPrefill, setProposalPrefill] = useState<ProposalFormPrefill | null>(null);
  const [logbookFilter, setLogbookFilter] = useState<string | undefined>();
  const [logbookHighlightId, setLogbookHighlightId] = useState<string | null>(null);

  useNativeBack(
    () => {
      if (page === 'proposalForm') {
        setProposalPrefill(null);
        setPage('proposals');
        return true;
      }
      if (page === 'proposals' && selectedProposalId) {
        setSelectedProposalId(null);
        return true;
      }
      if (page === 'home') return false;
      setCorrectionReportId(null);
      setSelectedProposalId(null);
      setProposalPrefill(null);
      setPage('home');
      return true;
    },
    page !== 'home' || !!selectedProposalId,
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

  function openProposalForm(prefill?: ProposalFormPrefill) {
    setProposalPrefill(prefill ?? null);
    setPage('proposalForm');
  }

  function goProposals(proposalId?: string | null) {
    setSelectedProposalId(proposalId ?? null);
    setPage('proposals');
  }

  function goLogbook(opts?: { filter?: string; entryId?: string | null }) {
    setLogbookFilter(opts?.filter);
    setLogbookHighlightId(opts?.entryId ?? null);
    if (opts?.filter) {
      try {
        sessionStorage.setItem('logbookInitialFilter', opts.filter);
      } catch {
        /* ignore */
      }
    }
    if (opts?.entryId) {
      try {
        sessionStorage.setItem('logbookHighlightEntryId', opts.entryId);
      } catch {
        /* ignore */
      }
    }
    setPage('logbook');
  }

  function renderPage() {
    switch (page) {
      case 'home':
        return usesDashboardHome(profile.role, defs) ? (
          <DashboardPage
            profile={profile}
            onOpenProposals={() => goProposals()}
            onOpenLogbook={(filter) => goLogbook({ filter })}
          />
        ) : (
          <StaffHome
            profile={profile}
            setPage={setPage}
            onOpenLogbook={(filter) => goLogbook({ filter: filter ?? 'my-assigned' })}
            onStartReport={startNewReport}
            onFixReport={startCorrection}
            onProposeChecklistItem={() => openProposalForm()}
            onOpenProposals={() => goProposals()}
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
            onProposeForTemplate={(prefill) => openProposalForm(prefill)}
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
      case 'proposals':
        return (
          <ChecklistItemProposalsPage
            profile={profile}
            onNewProposal={() => openProposalForm()}
            selectedProposalId={selectedProposalId}
            onSelectProposal={setSelectedProposalId}
          />
        );
      case 'proposalForm':
        return (
          <ChecklistItemProposalFormPage
            profile={profile}
            prefill={proposalPrefill}
            onCancel={() => {
              setProposalPrefill(null);
              setPage('proposals');
            }}
            onDone={(proposalId) => {
              setProposalPrefill(null);
              goProposals(proposalId ?? null);
            }}
          />
        );
      case 'corrective':
        return <CorrectiveActionsPage profile={profile} />;
      case 'photos':
        return <PhotoSheetPage profile={profile} />;
      case 'verify':
        return <VerifyPhotoPage profile={profile} />;
      case 'shifts':
        return <ShiftsPage profile={profile} />;
      case 'logbook':
        return (
          <LogbookPage
            profile={profile}
            initialFilter={logbookFilter}
            highlightEntryId={logbookHighlightId}
          />
        );
      default:
        return (
          <StaffHome
            profile={profile}
            setPage={setPage}
            onOpenLogbook={(filter) => goLogbook({ filter: filter ?? 'my-assigned' })}
            onStartReport={startNewReport}
            onFixReport={startCorrection}
            onProposeChecklistItem={() => openProposalForm()}
            onOpenProposals={() => goProposals()}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      <main className="page">
        <DesktopNav page={page} setPage={setPage} profile={profile} onOpenLogbook={() => goLogbook()} />
        {renderPage()}
        <MobileNav page={page} setPage={setPage} profile={profile} />
      </main>
    </div>
  );
}
