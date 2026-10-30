import { type McpServerInfo } from 'src/engine/api/mcp/utils/build-mcp-server-info.util';

export type McpInitializeResult = {
  protocolVersion: string;
  capabilities: Record<
    'tools' | 'resources' | 'prompts',
    { listChanged: boolean }
  >;
  serverInfo: McpServerInfo;
  instructions: string;
};
