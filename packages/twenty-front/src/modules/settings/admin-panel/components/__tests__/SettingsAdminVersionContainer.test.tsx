import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { GetVersionInfoDocument } from '~/generated-admin/graphql';
import { messages } from '~/locales/generated/en';

import { SettingsAdminVersionContainer } from '@/settings/admin-panel/components/SettingsAdminVersionContainer';

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const mocks = [
  {
    request: { query: GetVersionInfoDocument },
    result: {
      data: {
        versionInfo: {
          __typename: 'VersionInfo',
          currentVersion: '0.1.0-beta.abc123',
          latestVersion: null,
        },
      },
    },
  },
];

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={mocks}>
    <I18nProvider i18n={i18n}>{children}</I18nProvider>
  </MockedProvider>
);

describe('SettingsAdminVersionContainer', () => {
  it('renders the Betty version and the upstream Twenty version, with no link to Docker Hub', async () => {
    render(<SettingsAdminVersionContainer />, { wrapper: Wrapper });

    expect(await screen.findByText('0.1.0-beta.abc123')).toBeInTheDocument();
    expect(screen.getByText('Betty version')).toBeInTheDocument();

    expect(screen.getByText('Based on')).toBeInTheDocument();
    expect(screen.getByText('Twenty v2.51.0')).toBeInTheDocument();

    expect(screen.queryByText('Latest version')).not.toBeInTheDocument();
    expect(
      document.querySelector('a[href*="hub.docker.com"]'),
    ).not.toBeInTheDocument();
  });
});
