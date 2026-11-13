import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import {
  McpException,
  McpExceptionCode,
} from 'src/engine/api/mcp/exceptions/mcp.exception';
import { type McpListedPrompt } from 'src/engine/api/mcp/types/mcp-listed-prompt.type';
import { type McpPromptGetResult } from 'src/engine/api/mcp/types/mcp-prompt-get-result.type';
import { filterMcpUsableSkills } from 'src/engine/api/mcp/utils/filter-mcp-usable-skills.util';
import { truncateMcpSkillDescription } from 'src/engine/api/mcp/utils/truncate-mcp-skill-description.util';
import { CodeInterpreterService } from 'src/engine/core-modules/code-interpreter/code-interpreter.service';
import { LOAD_SKILL_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools';
import { type FlatSkill } from 'src/engine/metadata-modules/flat-skill/types/flat-skill.type';
import { SkillService } from 'src/engine/metadata-modules/skill/skill.service';

@Injectable()
export class McpPromptBuilderService {
  constructor(
    private readonly skillService: SkillService,
    private readonly codeInterpreterService: CodeInterpreterService,
  ) {}

  async listPrompts(workspaceId: string): Promise<McpListedPrompt[]> {
    const usableSkills = await this.getUsableSkills(workspaceId);

    return usableSkills.map((skill) => ({
      name: skill.name,
      title: skill.label,
      description: truncateMcpSkillDescription(
        skill.description ?? skill.label,
      ),
    }));
  }

  async getPrompt(
    workspaceId: string,
    name: string,
  ): Promise<McpPromptGetResult> {
    const usableSkills = await this.getUsableSkills(workspaceId);
    const skill = usableSkills.find((candidate) => candidate.name === name);

    if (!isDefined(skill)) {
      throw new McpException(
        `Unknown prompt: ${name}`,
        McpExceptionCode.INVALID_PARAMS,
      );
    }

    return {
      description: truncateMcpSkillDescription(
        skill.description ?? skill.label,
      ),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Load the "${skill.name}" skill with ${LOAD_SKILL_TOOL_NAME} and then follow it.`,
          },
        },
      ],
    };
  }

  private async getUsableSkills(workspaceId: string): Promise<FlatSkill[]> {
    const allSkills = await this.skillService.findAllFlatSkills(workspaceId);

    return filterMcpUsableSkills(
      allSkills,
      this.codeInterpreterService.isEnabled(),
    );
  }
}
