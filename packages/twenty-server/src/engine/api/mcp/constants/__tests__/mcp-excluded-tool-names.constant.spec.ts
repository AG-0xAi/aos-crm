import { MCP_EXCLUDED_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-excluded-tool-names.constant';
import {
  ACTION_TOOL_IDS,
  type ActionToolId,
} from 'src/engine/core-modules/tool-provider/constants/action-tool-label.constant';

// Where each action tool's request can end up. `third_party` means a
// destination outside this deployment that the caller does not choose, which is
// what must never be offered over MCP. `connected_account` is the caller's own
// named recipient through an account the workspace deliberately connected, and
// `deployment` never leaves it.
const DESTINATION_BY_ACTION_TOOL: Record<
  ActionToolId,
  'third_party' | 'connected_account' | 'deployment'
> = {
  http_request: 'third_party',
  code_interpreter: 'third_party',
  search_help_center: 'third_party',
  send_email: 'connected_account',
  draft_email: 'connected_account',
  create_calendar_event: 'connected_account',
  find_connected_accounts: 'deployment',
  save_campaign: 'deployment',
  create_file_upload: 'deployment',
  complete_file_upload: 'deployment',
  share_record: 'deployment',
};

describe('MCP_EXCLUDED_TOOL_NAMES', () => {
  it('should classify every action tool, so a new one cannot be offered unclassified', () => {
    expect(Object.keys(DESTINATION_BY_ACTION_TOOL).sort()).toEqual(
      [...ACTION_TOOL_IDS].sort(),
    );
  });

  it.each(
    ACTION_TOOL_IDS.filter(
      (id) => DESTINATION_BY_ACTION_TOOL[id] === 'third_party',
    ),
  )('should exclude %s, which sends workspace content to a third party', (id) => {
    expect(MCP_EXCLUDED_TOOL_NAMES.has(id)).toBe(true);
  });
});
