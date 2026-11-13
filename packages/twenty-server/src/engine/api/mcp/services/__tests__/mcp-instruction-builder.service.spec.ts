import { Test, type TestingModule } from '@nestjs/testing';

import { McpInstructionBuilderService } from 'src/engine/api/mcp/services/mcp-instruction-builder.service';
import { CodeInterpreterService } from 'src/engine/core-modules/code-interpreter/code-interpreter.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { SkillService } from 'src/engine/metadata-modules/skill/skill.service';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config.type';

const buildSkill = (name: string, description: string | null = null) => ({
  name,
  label: name,
  description,
});

describe('McpInstructionBuilderService', () => {
  let service: McpInstructionBuilderService;
  let skillService: jest.Mocked<SkillService>;
  let codeInterpreterService: jest.Mocked<CodeInterpreterService>;

  const rolePermissionConfig = {} as RolePermissionConfig;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpInstructionBuilderService,
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: {
            getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
              flatObjectMetadataMaps: { byUniversalIdentifier: {} },
            }),
          },
        },
        {
          provide: SkillService,
          useValue: { findAllFlatSkills: jest.fn() },
        },
        {
          provide: ToolRegistryService,
          useValue: { buildToolIndex: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: CodeInterpreterService,
          useValue: { isEnabled: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(McpInstructionBuilderService);
    skillService = module.get(SkillService);
    codeInterpreterService = module.get(CodeInterpreterService);
  });

  it('lists every active skill with its description when the code interpreter is enabled', async () => {
    skillService.findAllFlatSkills.mockResolvedValue([
      buildSkill('data-manipulation', 'Find and update records'),
      buildSkill('code-interpreter', 'Run Python'),
    ] as never);
    codeInterpreterService.isEnabled.mockReturnValue(true);

    const instructions = await service.buildInstructions({
      workspaceId: 'workspace-a',
      rolePermissionConfig,
      isDirectMode: false,
    });

    expect(instructions).toContain(
      'data-manipulation — Find and update records',
    );
    expect(instructions).toContain('code-interpreter — Run Python');
  });

  it('excludes code-interpreter skills from instructions when the code interpreter is disabled', async () => {
    skillService.findAllFlatSkills.mockResolvedValue([
      buildSkill('data-manipulation', 'Find and update records'),
      buildSkill('code-interpreter', 'Run Python'),
      buildSkill('xlsx', 'Work with spreadsheets'),
    ] as never);
    codeInterpreterService.isEnabled.mockReturnValue(false);

    const instructions = await service.buildInstructions({
      workspaceId: 'workspace-a',
      rolePermissionConfig,
      isDirectMode: false,
    });

    expect(instructions).toContain(
      'data-manipulation — Find and update records',
    );
    expect(instructions).not.toContain('code-interpreter');
    expect(instructions).not.toContain('xlsx');
  });

  it('builds instructions from the requested workspace only', async () => {
    skillService.findAllFlatSkills.mockImplementation(async (workspaceId) =>
      (workspaceId === 'workspace-a'
        ? [buildSkill('workspace-a-custom-skill', 'Only for workspace A')]
        : [buildSkill('workspace-b-custom-skill', 'Only for workspace B')]) as never,
    );
    codeInterpreterService.isEnabled.mockReturnValue(true);

    const instructionsForA = await service.buildInstructions({
      workspaceId: 'workspace-a',
      rolePermissionConfig,
      isDirectMode: false,
    });

    expect(skillService.findAllFlatSkills).toHaveBeenCalledWith(
      'workspace-a',
    );
    expect(instructionsForA).toContain('workspace-a-custom-skill');
    expect(instructionsForA).not.toContain('workspace-b-custom-skill');
  });
});
