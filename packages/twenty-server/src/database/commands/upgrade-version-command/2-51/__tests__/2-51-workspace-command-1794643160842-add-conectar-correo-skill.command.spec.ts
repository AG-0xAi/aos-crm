import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddConectarCorreoSkillCommand } from 'src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1794643160842-add-conectar-correo-skill.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_SKILL } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-skill.constant';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';
const STANDARD_APPLICATION_ID = '20202020-0000-0000-0000-0000000000a1';
const CONECTAR_CORREO_UNIVERSAL_IDENTIFIER =
  STANDARD_SKILL['conectar-correo'].universalIdentifier;

const setup = ({
  existingSkills = [],
}: {
  existingSkills?: { universalIdentifier: string; name: string }[];
} = {}) => {
  const validateBuildAndRunLegacyWorkspaceMigration = jest
    .fn()
    .mockResolvedValue({ status: 'success' });

  const command = new AddConectarCorreoSkillCommand(
    {} as WorkspaceIteratorService,
    {
      findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
        .fn()
        .mockResolvedValue({
          twentyStandardFlatApplication: {
            id: STANDARD_APPLICATION_ID,
            universalIdentifier: 'twenty-standard-universal-identifier',
          },
        }),
    } as unknown as ApplicationService,
    {
      getOrRecompute: jest.fn().mockResolvedValue({
        flatSkillMaps: {
          byUniversalIdentifier: Object.fromEntries(
            existingSkills.map((skill) => [skill.universalIdentifier, skill]),
          ),
        },
      }),
    } as unknown as WorkspaceCacheService,
    {
      validateBuildAndRunLegacyWorkspaceMigration,
    } as unknown as WorkspaceMigrationValidateBuildAndRunService,
  );

  return { command, validateBuildAndRunLegacyWorkspaceMigration };
};

describe('AddConectarCorreoSkillCommand', () => {
  it('creates conectar-correo when the workspace does not have it', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup();

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).toHaveBeenCalledTimes(
      1,
    );

    const skillOperation =
      validateBuildAndRunLegacyWorkspaceMigration.mock.calls[0][0]
        .allFlatEntityOperationByMetadataName.skill;

    expect(skillOperation.flatEntityToCreate).toHaveLength(1);
    expect(skillOperation.flatEntityToCreate[0].name).toBe('conectar-correo');
    expect(skillOperation.flatEntityToCreate[0].universalIdentifier).toBe(
      CONECTAR_CORREO_UNIVERSAL_IDENTIFIER,
    );
  });

  it('is a no-op on a second run, once the workspace already has it', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup({
      existingSkills: [
        {
          universalIdentifier: CONECTAR_CORREO_UNIVERSAL_IDENTIFIER,
          name: 'conectar-correo',
        },
      ],
    });

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });

  it('skips when a different skill already owns the name conectar-correo', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup({
      existingSkills: [
        {
          universalIdentifier: '20202020-0000-0000-0000-00000000c0de',
          name: 'conectar-correo',
        },
      ],
    });

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });

  it('runs no migration in dry run', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup();

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: { dryRun: true },
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });
});
