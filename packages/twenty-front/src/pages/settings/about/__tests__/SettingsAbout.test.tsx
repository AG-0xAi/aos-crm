import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { appVersionState } from '@/client-config/states/appVersionState';
import { sourceCodeUrlState } from '@/client-config/states/sourceCodeUrlState';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { SettingsAbout } from '~/pages/settings/about/SettingsAbout';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

dynamicActivate(SOURCE_LOCALE);

const renderSettingsAbout = () =>
  render(
    <MockedProvider>
      <JotaiProvider store={jotaiStore}>
        <MemoryRouter>
          <I18nProvider i18n={i18n}>
            <ToastProvider>
              <SettingsAbout />
            </ToastProvider>
          </I18nProvider>
        </MemoryRouter>
      </JotaiProvider>
    </MockedProvider>,
  );

describe('SettingsAbout', () => {
  beforeEach(() => {
    resetJotaiStore();
  });

  it('shows the version, the licence link and the source code link when sourceCodeUrl is set', () => {
    jotaiStore.set(appVersionState.atom, '1.2.3');
    jotaiStore.set(sourceCodeUrlState.atom, 'https://example.com/source');

    renderSettingsAbout();

    expect(screen.getByText('Version 1.2.3')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Read the license' }),
    ).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
    expect(
      screen.getByRole('link', { name: 'Source code (1.2.3)' }),
    ).toHaveAttribute('href', 'https://example.com/source');
  });

  it('states the fallback when sourceCodeUrl is not configured', () => {
    jotaiStore.set(appVersionState.atom, '1.2.3');
    jotaiStore.set(sourceCodeUrlState.atom, undefined);

    renderSettingsAbout();

    expect(
      screen.getByText(
        'source code link not configured on this server (1.2.3)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Source code/ }),
    ).not.toBeInTheDocument();
  });

  it('reports the version as not reported when unavailable', () => {
    jotaiStore.set(appVersionState.atom, undefined);
    jotaiStore.set(sourceCodeUrlState.atom, undefined);

    renderSettingsAbout();

    expect(
      screen.getByText('Version version not reported'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'source code link not configured on this server (version not reported)',
      ),
    ).toBeInTheDocument();
  });
});
