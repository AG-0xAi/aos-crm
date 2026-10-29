import { MCP_EXCLUDED_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-excluded-tool-names.constant';
import { getMcpPreloadToolNames } from 'src/engine/api/mcp/utils/get-mcp-preload-tool-names.util';
import { COMMON_PRELOAD_TOOLS } from 'src/engine/core-modules/tool-provider/constants/common-preload-tools.const';

describe('getMcpPreloadToolNames', () => {
  it('should not preload search_help_center, which posts the query to https://docs.twenty.com/mcp', () => {
    expect(COMMON_PRELOAD_TOOLS).toContain('search_help_center');
    expect(getMcpPreloadToolNames()).not.toContain('search_help_center');
  });

  it('should drop every excluded tool from the shared preload list', () => {
    for (const name of getMcpPreloadToolNames()) {
      expect(MCP_EXCLUDED_TOOL_NAMES.has(name)).toBe(false);
    }
  });

  it('should keep every preload tool that is not excluded', () => {
    expect(getMcpPreloadToolNames()).toEqual(
      COMMON_PRELOAD_TOOLS.filter((name) => !MCP_EXCLUDED_TOOL_NAMES.has(name)),
    );
  });
});
