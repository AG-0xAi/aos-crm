import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { SettingsAI } from '~/pages/settings/ai/SettingsAI';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

dynamicActivate(SOURCE_LOCALE);

jest.mock('~/pages/settings/ai/hooks/useCreateTool', () => ({
  useCreateTool: () => ({
    handleCreateTool: jest.fn(),
    isCreatingTool: false,
  }),
}));

jest.mock('@/settings/mcp/components/SettingsMcpSetup', () => ({
  SettingsMcpSetup: () => null,
}));

jest.mock('~/pages/settings/ai/components/SettingsAgentSkillsTab', () => ({
  SettingsAgentSkillsTab: () => null,
}));

jest.mock('~/pages/settings/ai/components/SettingsAgentToolsTab', () => ({
  SettingsAgentToolsTab: () => null,
}));

jest.mock('~/pages/settings/ai/components/SettingsAiModelsTab', () => ({
  SettingsAiModelsTab: () => null,
}));

jest.mock('~/pages/settings/ai/components/SettingsAiUsageTab', () => ({
  SettingsAiUsageTab: () => null,
}));

const renderSettingsAI = () =>
  render(
    <MockedProvider>
      <JotaiProvider store={jotaiStore}>
        <MemoryRouter>
          <I18nProvider i18n={i18n}>
            <ToastProvider>
              <SettingsAI />
            </ToastProvider>
          </I18nProvider>
        </MemoryRouter>
      </JotaiProvider>
    </MockedProvider>,
  );

describe('SettingsAI', () => {
  it('renders the hero card with no video element, iframe or play button', () => {
    renderSettingsAI();

    expect(screen.getAllByText('MCP').length).toBeGreaterThan(0);
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /watch/i }),
    ).not.toBeInTheDocument();
  });
});
