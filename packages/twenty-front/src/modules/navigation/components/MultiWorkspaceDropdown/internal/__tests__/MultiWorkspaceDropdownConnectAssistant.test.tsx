import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { MultiWorkspaceDropdownButton } from '@/navigation/components/MultiWorkspaceDropdown/MultiWorkspaceDropdownButton';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { mockCurrentWorkspace } from '~/testing/mock-data/users';

i18n.activate(SOURCE_LOCALE);

const renderDropdown = () =>
  render(
    <MockedProvider>
      <JotaiProvider store={jotaiStore}>
        <MemoryRouter>
          <I18nProvider i18n={i18n}>
            <ToastProvider>
              <MultiWorkspaceDropdownButton />
            </ToastProvider>
          </I18nProvider>
        </MemoryRouter>
      </JotaiProvider>
    </MockedProvider>,
  );

describe('MultiWorkspaceDropdownDefaultComponents', () => {
  beforeEach(() => {
    resetJotaiStore();
    jotaiStore.set(currentWorkspaceState.atom, mockCurrentWorkspace);
  });

  it('offers Connect ChatGPT or Claude next to the invite entries, pointing at the settings page', async () => {
    const user = userEvent.setup();

    renderDropdown();

    await user.click(screen.getByTestId('workspace-dropdown'));

    const connectAssistantItem = await screen.findByRole('menuitem', {
      name: 'Connect ChatGPT or Claude',
    });

    expect(connectAssistantItem).toHaveAttribute(
      'href',
      getSettingsPath(SettingsPath.ConnectAssistant),
    );
  });
});
