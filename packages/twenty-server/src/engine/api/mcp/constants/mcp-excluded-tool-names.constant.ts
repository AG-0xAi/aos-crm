import { OUTPUT_NAVIGATION_TOOL_NAMES } from 'src/engine/core-modules/tool/tools/output-navigation-tool/constants/output-navigation-tool-names.constant';

// A tool belongs here when its request destination is outside this deployment
// and the caller does not choose it: `search_help_center` posts the caller's
// query to the hardcoded vendor endpoint https://docs.twenty.com/mcp
// (search-help-center-tool.ts), so merely asking a question ships workspace
// text to a third party. Tools whose destination the caller names through the
// workspace's own connected account (send_email, draft_email,
// create_calendar_event) are that account's declared purpose and stay
// available: they are gated by their permission flags and by the presence of a
// connected account, so a role that withholds the flag withholds the tool.
export const MCP_EXCLUDED_TOOL_NAMES = new Set([
  'code_interpreter',
  'http_request',
  'search_help_center',
  ...OUTPUT_NAVIGATION_TOOL_NAMES,
]);
