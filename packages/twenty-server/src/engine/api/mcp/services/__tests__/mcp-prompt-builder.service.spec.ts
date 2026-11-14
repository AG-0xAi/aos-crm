import { Test, type TestingModule } from '@nestjs/testing';

import { McpException } from 'src/engine/api/mcp/exceptions/mcp.exception';
import { McpPromptBuilderService } from 'src/engine/api/mcp/services/mcp-prompt-builder.service';
import { CodeInterpreterService } from 'src/engine/core-modules/code-interpreter/code-interpreter.service';
import { LOAD_SKILL_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools';
import { isDefined } from 'twenty-shared/utils';
import { SkillService } from 'src/engine/metadata-modules/skill/skill.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

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
      skillService.findAllFlatSkills.mockImplementation(
        async (workspaceId) =>
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

  describe('listPrompts (R3.1)', () => {
    it('includes betty-guia as "Conóceme", via the real standard skill catalog', async () => {
      const { allFlatEntityMaps } =
        computeTwentyStandardApplicationAllFlatEntityMaps({
          now: '2026-01-01T00:00:00.000Z',
          workspaceId: '20202020-0000-0000-0000-000000000001',
          twentyStandardApplicationId: '20202020-0000-0000-0000-0000000000a1',
        });
      const standardSkills = Object.values(
        allFlatEntityMaps.flatSkillMaps.byUniversalIdentifier,
      ).filter(isDefined);

      skillService.findAllFlatSkills.mockResolvedValue(standardSkills as never);
      codeInterpreterService.isEnabled.mockReturnValue(false);

      const prompts = await service.listPrompts('workspace-a');
      const bettyGuiaPrompt = prompts.find(
        (prompt) => prompt.name === 'betty-guia',
      );

      expect(bettyGuiaPrompt?.title).toBe('Conóceme');
      expect(
        prompts.find((prompt) => prompt.name === 'conectar-correo')?.title,
      ).toBe('Conectar tu correo');
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
