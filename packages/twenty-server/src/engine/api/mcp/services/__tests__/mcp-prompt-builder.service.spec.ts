import { Test, type TestingModule } from '@nestjs/testing';

import { McpException } from 'src/engine/api/mcp/exceptions/mcp.exception';
import { McpPromptBuilderService } from 'src/engine/api/mcp/services/mcp-prompt-builder.service';
import { CodeInterpreterService } from 'src/engine/core-modules/code-interpreter/code-interpreter.service';
import { LOAD_SKILL_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools';
import { SkillService } from 'src/engine/metadata-modules/skill/skill.service';

const buildSkill = (name: string, description: string | null = null) => ({
  name,
  label: `${name} label`,
  description,
});

describe('McpPromptBuilderService', () => {
  let service: McpPromptBuilderService;
  let skillService: jest.Mocked<SkillService>;
  let codeInterpreterService: jest.Mocked<CodeInterpreterService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpPromptBuilderService,
        { provide: SkillService, useValue: { findAllFlatSkills: jest.fn() } },
        { provide: CodeInterpreterService, useValue: { isEnabled: jest.fn() } },
      ],
    }).compile();

    service = module.get(McpPromptBuilderService);
    skillService = module.get(SkillService);
    codeInterpreterService = module.get(CodeInterpreterService);
  });

  describe('listPrompts', () => {
    it('returns one prompt per active skill with name, title and description', async () => {
      skillService.findAllFlatSkills.mockResolvedValue([
        buildSkill('data-manipulation', 'Find and update records'),
      ] as never);
      codeInterpreterService.isEnabled.mockReturnValue(true);

      const prompts = await service.listPrompts('workspace-a');

      expect(prompts).toEqual([
        {
          name: 'data-manipulation',
          title: 'data-manipulation label',
          description: 'Find and update records',
        },
      ]);
    });

    it('excludes code-interpreter prompts when the code interpreter is disabled', async () => {
      skillService.findAllFlatSkills.mockResolvedValue([
        buildSkill('data-manipulation', 'Find and update records'),
        buildSkill('code-interpreter', 'Run Python'),
      ] as never);
      codeInterpreterService.isEnabled.mockReturnValue(false);

      const prompts = await service.listPrompts('workspace-a');

      expect(prompts.map((prompt) => prompt.name)).toEqual([
        'data-manipulation',
      ]);
    });

    it('only lists the requested workspace skills', async () => {
      skillService.findAllFlatSkills.mockImplementation(async (workspaceId) =>
        (workspaceId === 'workspace-a'
          ? [buildSkill('workspace-a-custom-skill')]
          : [buildSkill('workspace-b-custom-skill')]) as never,
      );
      codeInterpreterService.isEnabled.mockReturnValue(true);

      const prompts = await service.listPrompts('workspace-a');

      expect(skillService.findAllFlatSkills).toHaveBeenCalledWith(
        'workspace-a',
      );
      expect(prompts.map((prompt) => prompt.name)).toEqual([
        'workspace-a-custom-skill',
      ]);
    });
  });

  describe('getPrompt', () => {
    it('returns a user message asking the assistant to load and follow the skill', async () => {
      skillService.findAllFlatSkills.mockResolvedValue([
        buildSkill('data-manipulation', 'Find and update records'),
      ] as never);
      codeInterpreterService.isEnabled.mockReturnValue(true);

      const result = await service.getPrompt(
        'workspace-a',
        'data-manipulation',
      );

      expect(result.description).toBe('Find and update records');
      expect(result.messages).toEqual([
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Load the "data-manipulation" skill with ${LOAD_SKILL_TOOL_NAME} and then follow it.`,
          },
        },
      ]);
    });

    it('throws when the prompt name does not match any usable skill', async () => {
      skillService.findAllFlatSkills.mockResolvedValue([] as never);
      codeInterpreterService.isEnabled.mockReturnValue(true);

      await expect(
        service.getPrompt('workspace-a', 'unknown-skill'),
      ).rejects.toThrow(McpException);
    });

    it('throws for a code-interpreter skill when the code interpreter is disabled', async () => {
      skillService.findAllFlatSkills.mockResolvedValue([
        buildSkill('code-interpreter', 'Run Python'),
      ] as never);
      codeInterpreterService.isEnabled.mockReturnValue(false);

      await expect(
        service.getPrompt('workspace-a', 'code-interpreter'),
      ).rejects.toThrow(McpException);
    });
  });
});
