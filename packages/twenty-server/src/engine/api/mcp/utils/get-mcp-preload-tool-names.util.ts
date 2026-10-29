import { MCP_EXCLUDED_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-excluded-tool-names.constant';
import { COMMON_PRELOAD_TOOLS } from 'src/engine/core-modules/tool-provider/constants/common-preload-tools.const';

// The preload list is shared with the other AI surfaces, which may legitimately
// offer a tool MCP excludes; MCP has to subtract its own exclusions or a
// preloaded tool reaches tools/list without ever passing through them.
export const getMcpPreloadToolNames = (): string[] =>
  COMMON_PRELOAD_TOOLS.filter((name) => !MCP_EXCLUDED_TOOL_NAMES.has(name));
