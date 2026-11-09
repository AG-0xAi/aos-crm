import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { themeCssVariables } from 'twenty-ui/theme';

import { McpConnectAssistant } from '@/settings/mcp/components/McpConnectAssistant';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';

const StyledTroubleshootingList = styled.ul`
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  margin: 0;
  padding-left: ${themeCssVariables.spacing[5]};
`;

// Every member connects their own OAuth session, so this page is reachable by
// every signed-in member regardless of the AI_SETTINGS permission flag that
// gates Settings > AI (CRM-033): it is where someone who connected once and
// lost the connector comes back to redo it.
export const SettingsConnectAssistant = () => {
  return (
    <SettingsPageLayout
      title={t`Connect ChatGPT or Claude`}
      links={[
        { children: t`User`, href: getSettingsPath(SettingsPath.ProfilePage) },
        { children: t`Connect ChatGPT or Claude` },
      ]}
    >
      <SettingsPageContainer>
        <Section.Root>
          <Section.Header
            title={t`Connect your assistant`}
            description={t`You connect with your own account, so this is personal to you, not a workspace setting.`}
          />
          <McpConnectAssistant />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Troubleshooting`}
            description={t`If the connector stops showing up inside Claude or ChatGPT, check these first.`}
          />
          <StyledTroubleshootingList>
            <li>
              {t`In Claude, open Settings › Connectors: if "Betty" is listed with "Connect", press it; if it is not listed, press "Open Claude" above again.`}
            </li>
            <li>{t`Inside a chat, turn Betty on from the tools menu.`}</li>
            <li>
              {t`Custom connectors are added on claude.ai on the web or in the desktop app, not in the phone app.`}
            </li>
            <li>
              {t`The URL must be your workspace's address ending in "/mcp".`}
            </li>
          </StyledTroubleshootingList>
        </Section.Root>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
