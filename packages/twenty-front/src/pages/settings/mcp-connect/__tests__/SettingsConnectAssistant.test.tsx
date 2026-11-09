import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from 'twenty-ui/components/feedback';
import { ThemeProvider } from 'twenty-ui/theme';

import { SettingsConnectAssistant } from '~/pages/settings/mcp-connect/SettingsConnectAssistant';

// The real module reads window._env_ once at import time, so the base URL is
// swapped through a getter instead: each case needs a different one.
const config = { serverBaseUrl: 'https://betty.example.invalid' };

jest.mock('~/config', () => ({
  get REACT_APP_SERVER_BASE_URL() {
    return config.serverBaseUrl;
  },
}));

const renderPage = (serverBaseUrl: string) => {
  config.serverBaseUrl = serverBaseUrl;

  return render(
    <MockedProvider>
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ToastProvider>
            <ThemeProvider colorScheme="light">
              <SettingsConnectAssistant />
            </ThemeProvider>
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>
    </MockedProvider>,
  );
};

describe('SettingsConnectAssistant', () => {
  it('shows this workspace MCP URL ending in /mcp and the Claude connector link', () => {
    renderPage('https://betty.example.invalid');

    expect(
      screen.getByText('https://betty.example.invalid/mcp'),
    ).toBeInTheDocument();

    const claudeLink = screen.getByRole('link', {
      name: /Open Claude/,
    }) as HTMLAnchorElement;

    expect(new URL(claudeLink.href).searchParams.get('connectorUrl')).toBe(
      'https://betty.example.invalid/mcp',
    );
  });

  it('gives the troubleshooting steps for a connector that stopped showing up', () => {
    renderPage('https://betty.example.invalid');

    expect(screen.getByText(/open Settings › Connectors/)).toBeInTheDocument();
    expect(
      screen.getByText(/turn Betty on from the tools menu/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not in the phone app/)).toBeInTheDocument();
  });
});
