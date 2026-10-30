import { Injectable } from '@nestjs/common';

import { BRAND_NAME } from 'twenty-shared/constants';

import {
  type SearchHelpCenterInput,
  SearchHelpCenterInputZodSchema,
} from 'src/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.schema';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';

// CRM-019 (R2): this tool used to POST the caller's question to
// https://docs.twenty.com/mcp. CRM-007 kept it out of the MCP surface, but it
// is in COMMON_PRELOAD_TOOLS, so the in-product AI chat could still reach it --
// and every question asked there left for a Twenty-hosted endpoint.
//
// There is no searchable help centre to replace it with: HELP_CENTER_URL is a
// web address, not an MCP server. So the tool stays registered (the model's
// prompt still steers it here instead of inventing menus) and answers that it
// cannot confirm anything. It performs no request at all.
@Injectable()
export class SearchHelpCenterTool implements Tool {
  description = `Search ${BRAND_NAME}'s documentation before saying how to do something in ${BRAND_NAME}, where it is or whether it exists. This deployment has no searchable documentation, so this tool always reports that it could not confirm: say so instead of naming menus, buttons, options or steps from memory.`;
  inputSchema = SearchHelpCenterInputZodSchema;

  async execute(
    parameters: ToolInput,
    _context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const { query } = parameters as SearchHelpCenterInput;

    return {
      success: true,
      message: `This deployment has no searchable documentation, so "${query}" could not be confirmed. Do not guess menus, buttons, options or steps from memory: say you could not confirm them and offer to do the task when your tools can.`,
      result: [],
    };
  }
}
