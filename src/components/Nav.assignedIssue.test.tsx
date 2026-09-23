/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DesktopNav, MobileNav, useAssignedIssueExists } from './Nav';
import { defaultDefinitionsAsEntities } from '../lib/roleResolver';
import type { Profile } from '../types';

const { queryCalls } = vi.hoisted(() => ({ queryCalls: [] as unknown[] }));

vi.mock('../db', () => ({
  db: {
    useQuery: (query: unknown) => {
      queryCalls.push(query);
      return { data: { logbookEntries: [] }, isLoading: false, error: null };
    },
  },
}));

vi.mock('../contexts/RoleDefinitionsContext', () => ({
  useRoleDefinitions: () => ({ defs: defaultDefinitionsAsEntities(), isLoading: false }),
}));

vi.mock('../i18n', () => ({
  useLang: () => ({
    t: {
      nav: {
        dashboard: 'Dashboard',
        submit: 'Submit',
        community: 'Community',
        review: 'Review',
        templates: 'Templates',
        stores: 'Stores',
        proposals: 'Proposals',
        users: 'Users',
        corrective: 'Corrective',
        photos: 'Photo Sheet',
        verify: 'Verify Photo',
        logbook: 'Logbook',
        shifts: 'Shifts',
        profile: 'Profile',
        signOut: 'Sign out',
      },
    },
  }),
}));

vi.mock('../hooks/useNotificationUnreadCount', () => ({
  useUnreadNotificationCount: () => 0,
}));

vi.mock('./community/useCommunityNewActivityCount', () => ({
  useCommunityNewActivityCount: () => ({
    count: 0,
    capped: false,
    badgeLabel: '0',
    showBadge: false,
    enabled: true,
  }),
}));

vi.mock('../lib/wifiNotifyLogout', () => ({
  signOutWithWifiDeactivate: vi.fn(),
}));

vi.mock('./LanguageSelector', () => ({
  default: () => <span>lang</span>,
}));

vi.mock('./profileAvatar/ProfileAvatar', () => ({
  default: () => <span>avatar</span>,
}));

vi.mock('./profileAvatar/ProfileAvatarPreview', () => ({
  default: () => <button type="button">profile-preview</button>,
}));

function staff(): Profile {
  return {
    id: 'p-staff',
    userId: 'u-staff',
    email: 'staff@test.com',
    displayName: 'Staff',
    role: 'staff',
    approvalStatus: 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    stores: [],
  };
}

afterEach(() => {
  cleanup();
  queryCalls.length = 0;
});

describe('Nav assignedIssueExists ownership', () => {
  it('does not subscribe from DesktopNav or MobileNav when the parent passes assignedIssueExists', () => {
    render(
      <>
        <DesktopNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists={false} />
        <MobileNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists={false} />
      </>,
    );
    expect(queryCalls).toEqual([]);
    expect(screen.queryAllByRole('button', { name: 'Logbook' })).toHaveLength(0);
  });

  it('shows Logbook on both navs when assignedIssueExists is true for staff', () => {
    render(
      <>
        <DesktopNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists />
        <MobileNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists />
      </>,
    );
    expect(queryCalls).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Logbook' }).length).toBeGreaterThanOrEqual(2);
  });

  it('subscribes once when AppShell owns the hook and both navs are mounted', async () => {
    function ShellNav() {
      const assigned = useAssignedIssueExists(staff());
      return (
        <>
          <DesktopNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists={assigned} />
          <MobileNav page="home" setPage={() => {}} profile={staff()} assignedIssueExists={assigned} />
        </>
      );
    }
    render(<ShellNav />);
    expect(queryCalls).toEqual([{ logbookEntries: {} }]);
    await waitFor(() => {
      expect(queryCalls).toHaveLength(1);
    });
  });
});
