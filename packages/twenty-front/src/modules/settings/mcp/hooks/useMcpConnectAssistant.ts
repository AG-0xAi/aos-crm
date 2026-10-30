import { useMemo } from 'react';

import {
  buildClaudeInstallLink,
  buildMcpServerUrl,
  isHttpsUrl,
} from '@/settings/mcp/utils/mcpSetup';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

export type McpConnectAssistant = {
  // undefined when the server base URL is not a URL this build can resolve.
  // Callers must render an explicit absence state instead of a broken link.
  mcpServerUrl: string | undefined;
  claudeInstallLink: string | undefined;
  isMcpServerUrlPubliclyReachable: boolean;
};

// buildMcpServerUrl stays the single source of the workspace's MCP URL: CRM-018
// moves the API behind its own subdomain and REACT_APP_SERVER_BASE_URL is what
// changes, not this derivation.
export const useMcpConnectAssistant = (): McpConnectAssistant =>
  useMemo(() => {
    const mcpServerUrl = buildMcpServerUrl(REACT_APP_SERVER_BASE_URL);

    try {
      new URL(mcpServerUrl);
    } catch {
      return {
        mcpServerUrl: undefined,
        claudeInstallLink: undefined,
        isMcpServerUrlPubliclyReachable: false,
      };
    }

    // Both hosted assistants fetch the MCP URL from their own servers, so an
    // http:// or loopback URL cannot work however well-formed it is.
    const isMcpServerUrlPubliclyReachable = isHttpsUrl(mcpServerUrl);

    return {
      mcpServerUrl,
      claudeInstallLink: isMcpServerUrlPubliclyReachable
        ? buildClaudeInstallLink(mcpServerUrl)
        : undefined,
      isMcpServerUrlPubliclyReachable,
    };
  }, []);
