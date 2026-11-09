import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Dropdown } from 'twenty-ui/components/navigation';

import {
  type CurrentUser,
  currentUserState,
} from '@/auth/states/currentUserState';
import { availableWorkspacesState } from '@/auth/states/availableWorkspacesState';
import {
  type CurrentWorkspace,
  currentWorkspaceState,
} from '@/auth/states/currentWorkspaceState';
import { isMultiWorkspaceEnabledState } from '@/client-config/states/isMultiWorkspaceEnabledState';
import { supportChatState } from '@/client-config/states/supportChatState';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownRoot } from '@/ui/layout/dropdown/components/DropdownRoot';
import { MultiWorkspaceDropdownDefaultComponents } from '@/navigation/components/MultiWorkspaceDropdown/internal/MultiWorkspaceDropdownDefaultComponents';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';
import { SupportDriver } from '~/generated-metadata/graphql';

const mockSignOut = jest.fn();
jest.mock('@/auth/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

const mockRedirectToDefaultDomain = jest.fn();
jest.mock('@/domain-manager/hooks/useRedirectToDefaultDomain', () => ({
  useRedirectToDefaultDomain: () => ({
    redirectToDefaultDomain: mockRedirectToDefaultDomain,
  }),
}));

jest.mock('@/settings/experience/hooks/useOpenRecordInPreference', () => ({
  useOpenRecordInPreference: () => ({ openRecordInPreference: 'SIDE_PANEL' }),
}));

jest.mock('@/workspace-member/hooks/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'System',
    colorSchemeList: [],
    setColorScheme: jest.fn(),
  }),
}));

jest.mock('twenty-ui/utilities', () => ({
  ...jest.requireActual('twenty-ui/utilities'),
  useIsMobile: () => false,
}));

const mockNavigateSettings = jest.fn();
jest.mock('~/hooks/useNavigateSettings', () => ({
  useNavigateSettings: () => mockNavigateSettings,
}));

let atomValuesByKey: Record<string, unknown> = {};
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: (state: { key: string }) => atomValuesByKey[state.key],
}));

dynamicActivate(SOURCE_LOCALE);

const ADMIN_USER = {
  id: 'user-1',
  canAccessFullAdminPanel: true,
} as unknown as CurrentUser;

const NON_ADMIN_USER = {
  id: 'user-2',
  canAccessFullAdminPanel: false,
} as unknown as CurrentUser;

const CURRENT_WORKSPACE = {
  id: 'workspace-1',
  displayName: 'Acme',
} as unknown as CurrentWorkspace;

const setAtomValues = (currentUser: CurrentUser | null) => {
  atomValuesByKey = {
    [currentUserState.key]: currentUser,
    [currentWorkspaceState.key]: CURRENT_WORKSPACE,
    [isMultiWorkspaceEnabledState.key]: false,
    [availableWorkspacesState.key]: {
      availableWorkspacesForSignIn: [],
      availableWorkspacesForSignUp: [],
    },
    [supportChatState.key]: {
      supportDriver: SupportDriver.NONE,
      supportFrontChatId: null,
    },
  };
};

const renderDropdown = async () => {
  const user = userEvent.setup();

  render(
    <MemoryRouter>
      <I18nProvider i18n={i18n}>
        <DropdownRoot dropdownId="test-workspace-dropdown" type="menu">
          <Dropdown.Trigger>Workspace menu</Dropdown.Trigger>
          <DropdownContent aria-label="Workspace menu">
            <MultiWorkspaceDropdownDefaultComponents />
          </DropdownContent>
        </DropdownRoot>
      </I18nProvider>
    </MemoryRouter>,
  );

  await user.click(screen.getByRole('button', { name: 'Workspace menu' }));

  return user;
};

describe('MultiWorkspaceDropdownDefaultComponents', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows both invite entries to an admin-panel user', async () => {
    setAtomValues(ADMIN_USER);

    await renderDropdown();

    expect(
      screen.getByRole('menuitem', { name: /Invite someone to Betty/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', {
        name: /Invite someone to your workspace/,
      }),
    ).toBeInTheDocument();
  });

  it('hides the Betty invite entry from a user without admin-panel access', async () => {
    setAtomValues(NON_ADMIN_USER);

    await renderDropdown();

    expect(
      screen.queryByRole('menuitem', { name: /Invite someone to Betty/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', {
        name: /Invite someone to your workspace/,
      }),
    ).toBeInTheDocument();
  });

  it('navigates to the dedicated settings page when inviting someone to Betty', async () => {
    setAtomValues(ADMIN_USER);

    const user = await renderDropdown();

    await user.click(
      screen.getByRole('menuitem', { name: /Invite someone to Betty/ }),
    );

    expect(mockNavigateSettings).toHaveBeenCalledWith(
      SettingsPath.InviteToBetty,
    );
  });

  it('links to the workspace members invite tab when inviting someone to the workspace', async () => {
    setAtomValues(ADMIN_USER);

    await renderDropdown();

    const workspaceInviteItem = screen.getByRole('menuitem', {
      name: /Invite someone to your workspace/,
    });

    expect(workspaceInviteItem).toHaveAttribute(
      'href',
      `${getSettingsPath(SettingsPath.WorkspaceMembersPage)}#invite`,
    );
  });
});
