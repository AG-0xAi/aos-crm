// AOS-CRM CRM-019 (R3): the step offered right after a workspace is created,
// and the header of Settings > AI > MCP.
//
// What this exists to measure: the card must offer Claude with THIS workspace's
// MCP URL prefilled under the name Betty, must give the ChatGPT steps with that
// same URL to copy, and must say so out loud when there is no usable URL rather
// than render a link that would fail inside Claude. The MCP URL comes from
// buildMcpServerUrl and nowhere else -- CRM-018 moves the API to its own
// subdomain, and that must keep being the only derivation.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'twenty-ui/theme';

import { McpConnectAssistant } from '@/settings/mcp/components/McpConnectAssistant';

// The real module reads window._env_ once at import time, so the base URL is
// swapped through a getter instead: each case needs a different one.
const config = { serverBaseUrl: 'https://betty.example.invalid' };

jest.mock('~/config', () => ({
  get REACT_APP_SERVER_BASE_URL() {
    return config.serverBaseUrl;
  },
}));

const renderCard = (serverBaseUrl: string) => {
  config.serverBaseUrl = serverBaseUrl;

  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider colorScheme="light">
        <McpConnectAssistant />
      </ThemeProvider>
    </I18nProvider>,
  );
};

const claudeLink = () =>
  screen.queryByRole('link', { name: /Open Claude/ }) as HTMLAnchorElement | null;

describe('McpConnectAssistant', () => {
  it('prefills the Claude connector with the name Betty and this workspace MCP URL', () => {
    renderCard('https://betty.example.invalid');

    const link = claudeLink();

    expect(link).not.toBeNull();

    const params = new URL(link!.href).searchParams;

    expect(params.get('modal')).toBe('add-custom-connector');
    expect(params.get('connectorName')).toBe('Betty');
    expect(params.get('connectorUrl')).toBe(
      'https://betty.example.invalid/mcp',
    );
  });

  it('shows the MCP URL the workspace actually serves, ready to copy', () => {
    renderCard('https://betty.example.invalid/');

    expect(
      screen.getByText('https://betty.example.invalid/mcp'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Copy to Clipboard/ }),
    ).toBeInTheDocument();
  });

  it('offers ChatGPT as hand-entered steps, with a link to OpenAI own guide', () => {
    renderCard('https://betty.example.invalid');

    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1);
    expect(
      screen.getByRole('link', { name: /OpenAI's guide/ }),
    ).toHaveAttribute(
      'href',
      'https://developers.openai.com/api/docs/guides/custom-mcp-server',
    );
  });

  it('withholds the Claude link and says why when the URL is not public HTTPS', () => {
    renderCard('http://localhost:3000');

    expect(claudeLink()).toBeNull();
    expect(screen.getByText('http://localhost:3000/mcp')).toBeInTheDocument();
    expect(
      screen.getByText(/need a public HTTPS address/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Available once this workspace is served over HTTPS/),
    ).toBeInTheDocument();
  });

  it('reports the absence instead of inventing a URL when there is no server address', () => {
    renderCard('not a url');

    expect(claudeLink()).toBeNull();
    expect(
      screen.getByLabelText('MCP URL not available'),
    ).toHaveTextContent('—');
    expect(
      screen.getByText(/did not report a server address/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Copy to Clipboard/ }),
    ).toBeNull();
  });

  it('never names Twenty anywhere a user can read it', () => {
    const { container } = renderCard('https://betty.example.invalid');

    expect(container.textContent).not.toMatch(/twenty/i);
  });
});
