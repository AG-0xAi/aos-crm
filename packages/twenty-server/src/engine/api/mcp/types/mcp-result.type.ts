import { type McpInitializeResult } from 'src/engine/api/mcp/types/mcp-initialize-result.type';
import { type McpPromptGetResult } from 'src/engine/api/mcp/types/mcp-prompt-get-result.type';
import { type McpPromptsListResult } from 'src/engine/api/mcp/types/mcp-prompts-list-result.type';
import { type McpToolCallResult } from 'src/engine/api/mcp/types/mcp-tool-call-result.type';
import { type McpToolsListResult } from 'src/engine/api/mcp/types/mcp-tools-list-result.type';

export type McpResult =
  | McpInitializeResult
  | McpToolCallResult
  | McpToolsListResult
  | McpPromptsListResult
  | McpPromptGetResult
  | { resources: [] }
  | Record<string, never>;
