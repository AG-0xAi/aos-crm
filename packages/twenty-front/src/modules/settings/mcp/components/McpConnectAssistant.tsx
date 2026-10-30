import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { BRAND_NAME } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { IconExternalLink } from 'twenty-ui/icon';
import { Card } from 'twenty-ui/primitives/surfaces';
import { MOBILE_VIEWPORT, themeCssVariables, useTheme } from 'twenty-ui/theme';

import ClaudeLogo from '@/settings/mcp/assets/mcp-clients/claude-color.png';
import OpenAiLogo from '@/settings/mcp/assets/mcp-clients/openai.svg';
import { McpClientLogo } from '@/settings/mcp/components/McpClientLogo';
import { MCP_SETUP } from '@/settings/mcp/constants/McpSetup';
import { useMcpConnectAssistant } from '@/settings/mcp/hooks/useMcpConnectAssistant';
import { LightCopyIconButton } from '@/ui/input/components/LightCopyIconButton';

const StyledRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledChoices = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    grid-template-columns: 1fr;
  }
`;

const StyledChoiceContent = styled(Card.Content)`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledChoiceHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

// McpClientLogo fills its container, so the size lives here, as it does on the
// setup cards next to it.
const StyledLogo = styled.div`
  align-items: center;
  display: flex;
  flex: 0 0 ${themeCssVariables.spacing[7]};
  height: ${themeCssVariables.spacing[7]};
  justify-content: center;
  width: ${themeCssVariables.spacing[7]};
`;

const StyledChoiceTitle = styled.h3`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin: 0;
`;

const StyledSteps = styled.ol`
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  margin: 0;
  padding-left: ${themeCssVariables.spacing[5]};
`;

const StyledDescription = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  margin: 0;
`;

const StyledAction = styled.a`
  align-items: center;
  align-self: flex-start;
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.background.transparent.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  height: ${themeCssVariables.spacing[7]};
  padding: 0 ${themeCssVariables.spacing[3]};
  text-decoration: none;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.strong};
    outline-offset: 2px;
  }
`;

const StyledUrlRow = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledUrlLabel = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledUrl = styled.code`
  color: ${themeCssVariables.font.color.primary};
  font-family: ${themeCssVariables.code.font.family}, monospace;
  font-size: ${themeCssVariables.font.size.sm};
  overflow-wrap: anywhere;
`;

const StyledNote = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin: 0;
`;

// The step after the workspace is created, and the header of Settings > AI >
// MCP: the two hosted assistants a beta user actually has, and nothing else.
// Every piece of state is rendered on purpose -- an MCP URL this build cannot
// resolve says so, and a URL the assistants cannot reach says that too, rather
// than offering a link that would fail once the user is inside Claude.
export const McpConnectAssistant = () => {
  const { t } = useLingui();
  const theme = useTheme();
  const { mcpServerUrl, claudeInstallLink, isMcpServerUrlPubliclyReachable } =
    useMcpConnectAssistant();

  return (
    <StyledRoot>
      <StyledUrlRow>
        <div>
          <StyledUrlLabel>{t`Your workspace MCP URL`}</StyledUrlLabel>
          <div>
            {isDefined(mcpServerUrl) ? (
              <StyledUrl>{mcpServerUrl}</StyledUrl>
            ) : (
              <StyledUrl aria-label={t`MCP URL not available`}>—</StyledUrl>
            )}
          </div>
        </div>
        {isDefined(mcpServerUrl) && (
          <LightCopyIconButton copyText={mcpServerUrl} />
        )}
      </StyledUrlRow>

      {!isDefined(mcpServerUrl) && (
        <StyledNote role="status">
          {t`This deployment did not report a server address, so there is no MCP URL to connect yet.`}
        </StyledNote>
      )}

      {isDefined(mcpServerUrl) && !isMcpServerUrlPubliclyReachable && (
        <StyledNote role="status">
          {t`Claude and ChatGPT fetch this URL from their own servers, so they need a public HTTPS address. This one is not reachable from outside this machine yet.`}
        </StyledNote>
      )}

      <StyledChoices>
        <Card.Root>
          <StyledChoiceContent>
            <StyledChoiceHeader>
              <StyledLogo>
                <McpClientLogo src={ClaudeLogo} />
              </StyledLogo>
              <StyledChoiceTitle>{t`Claude`}</StyledChoiceTitle>
            </StyledChoiceHeader>
            <StyledDescription>
              {t`Opens Claude with the connector named ${BRAND_NAME} and this workspace's MCP URL already filled in.`}
            </StyledDescription>
            {isDefined(claudeInstallLink) ? (
              <StyledAction
                href={claudeInstallLink}
                rel="noopener noreferrer"
                target="_blank"
              >
                <IconExternalLink size={theme.icon.size.sm} />
                {t`Open Claude`}
              </StyledAction>
            ) : (
              <StyledNote>{t`Available once this workspace is served over HTTPS.`}</StyledNote>
            )}
          </StyledChoiceContent>
        </Card.Root>

        <Card.Root>
          <StyledChoiceContent>
            <StyledChoiceHeader>
              <StyledLogo>
                <McpClientLogo src={OpenAiLogo} invertInDarkMode />
              </StyledLogo>
              <StyledChoiceTitle>{t`ChatGPT`}</StyledChoiceTitle>
            </StyledChoiceHeader>
            <StyledDescription>
              {t`ChatGPT has no preset link, so add the MCP URL above by hand:`}
            </StyledDescription>
            <StyledSteps>
              <li>{t`Open chatgpt.com/plugins and select the plus button, then "Add custom MCP server".`}</li>
              <li>{t`Name it ${BRAND_NAME}.`}</li>
              <li>{t`Under "Connection", paste the MCP URL above as the Server URL.`}</li>
              <li>{t`For authentication choose "OAuth".`}</li>
              <li>{t`Accept the warning with "I understand and want to continue", then "Create as a plugin".`}</li>
              <li>{t`Install the plugin, then call it in a chat by typing @ and picking ${BRAND_NAME}.`}</li>
            </StyledSteps>
            <StyledAction
              href={MCP_SETUP.clientDocsUrls.chatGpt}
              rel="noopener noreferrer"
              target="_blank"
            >
              <IconExternalLink size={theme.icon.size.sm} />
              {t`OpenAI's guide`}
            </StyledAction>
          </StyledChoiceContent>
        </Card.Root>
      </StyledChoices>
    </StyledRoot>
  );
};
