import { BRAND_NAME } from 'twenty-shared/constants';

export const MCP_SETUP = {
  tooltipIds: {
    claudeInstallDisabled: 'mcp-claude-install-disabled',
    replitInstallDisabled: 'mcp-replit-install-disabled',
  },
  authorizationHeader: {
    key: 'Authorization',
    value: 'Bearer <YOUR_API_KEY>',
  },
  server: {
    name: 'betty',
    displayName: BRAND_NAME,
  },
  clientDocsUrls: {
    augment: 'https://docs.augmentcode.com/setup-augment/mcp',
    amazonQ:
      'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/qdev-mcp.html',
    // OpenAI's current guide for adding a custom MCP server from the ChatGPT
    // Plugins page. Checked 2026-10-30: it no longer requires turning on a
    // separate "developer mode" first.
    chatGpt: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
    cline: 'https://docs.cline.bot/mcp/mcp-overview',
    geminiCli: 'https://geminicli.com/docs/tools/mcp-server/',
    jetbrains: 'https://www.jetbrains.com/help/ai-assistant/mcp.html',
    libreChat: 'https://www.librechat.ai/docs/features/mcp',
    lmStudio: 'https://lmstudio.ai/docs/app/mcp',
    raycast: 'https://manual.raycast.com/ai/model-context-protocol',
    warp: 'https://docs.warp.dev/agent-platform/capabilities/mcp/',
    windsurf: 'https://docs.devin.ai/desktop/cascade/mcp',
    zed: 'https://zed.dev/docs/ai/mcp',
  },
} as const;
