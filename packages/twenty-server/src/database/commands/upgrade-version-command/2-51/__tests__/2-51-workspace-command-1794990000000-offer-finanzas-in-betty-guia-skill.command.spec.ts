import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { OfferFinanzasInBettyGuiaSkillCommand } from 'src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1794990000000-offer-finanzas-in-betty-guia-skill.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_SKILL } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-skill.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';
const STANDARD_APPLICATION_ID = '20202020-0000-0000-0000-0000000000a1';
const BETTY_GUIA_UNIVERSAL_IDENTIFIER =
  STANDARD_SKILL['betty-guia'].universalIdentifier;
const STALE_CONTENT = '__STALE_PLACEHOLDER__';

const getCurrentCatalogContent = (): string => {
  const { allFlatEntityMaps } = computeTwentyStandardApplicationAllFlatEntityMaps({
    now: new Date().toISOString(),
    workspaceId: WORKSPACE_ID,
    twentyStandardApplicationId: STANDARD_APPLICATION_ID,
  });

  const standardBettyGuiaSkill = findFlatEntityByUniversalIdentifier({
    universalIdentifier: BETTY_GUIA_UNIVERSAL_IDENTIFIER,
    flatEntityMaps: allFlatEntityMaps.flatSkillMaps,
  });

  if (!standardBettyGuiaSkill) {
    throw new Error('betty-guia missing from catalog in test setup');
  }

  return standardBettyGuiaSkill.content;
};

const setup = ({
  existingContent,
}: {
  existingContent?: string;
} = {}) => {
  const validateBuildAndRunLegacyWorkspaceMigration = jest
    .fn()
    .mockResolvedValue({ status: 'success' });

  const byUniversalIdentifier =
    existingContent === undefined
      ? {}
      : {
          [BETTY_GUIA_UNIVERSAL_IDENTIFIER]: {
            universalIdentifier: BETTY_GUIA_UNIVERSAL_IDENTIFIER,
            name: 'betty-guia',
            content: existingContent,
          },
        };

  const command = new OfferFinanzasInBettyGuiaSkillCommand(
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
      getOrRecompute: jest
        .fn()
        .mockResolvedValue({ flatSkillMaps: { byUniversalIdentifier } }),
    } as unknown as WorkspaceCacheService,
    {
      validateBuildAndRunLegacyWorkspaceMigration,
    } as unknown as WorkspaceMigrationValidateBuildAndRunService,
  );

  return { command, validateBuildAndRunLegacyWorkspaceMigration };
};

describe('OfferFinanzasInBettyGuiaSkillCommand', () => {
  it('skips when the workspace does not have betty-guia yet', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup();

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });

  it('updates the content when it drifted from the catalog', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup({
      existingContent: STALE_CONTENT,
    });

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

    expect(skillOperation.flatEntityToUpdate).toHaveLength(1);
    expect(skillOperation.flatEntityToUpdate[0].universalIdentifier).toBe(
      BETTY_GUIA_UNIVERSAL_IDENTIFIER,
    );
    expect(skillOperation.flatEntityToUpdate[0].content).not.toBe(
      STALE_CONTENT,
    );
  });

  it('is a no-op once the content already matches the catalog', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup({
      existingContent: getCurrentCatalogContent(),
    });

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });

  it('runs no migration in dry run even when content is stale', async () => {
    const { command, validateBuildAndRunLegacyWorkspaceMigration } = setup({
      existingContent: STALE_CONTENT,
    });

    await command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: { dryRun: true },
    } as Parameters<typeof command.runOnWorkspace>[0]);

    expect(validateBuildAndRunLegacyWorkspaceMigration).not.toHaveBeenCalled();
  });

  it('writes content that offers the Finanzas template, and a second run changes nothing', async () => {
    const first = setup({ existingContent: STALE_CONTENT });

    await first.command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof first.command.runOnWorkspace>[0]);

    const writtenContent =
      first.validateBuildAndRunLegacyWorkspaceMigration.mock.calls[0][0]
        .allFlatEntityOperationByMetadataName.skill.flatEntityToUpdate[0]
        .content;

    expect(writtenContent).toContain('list_templates');
    expect(writtenContent).toContain('install_template');
    expect(writtenContent).toContain(
      'Organizar mis cuentas y finanzas personales',
    );

    const second = setup({ existingContent: writtenContent });

    await second.command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: {},
    } as Parameters<typeof second.command.runOnWorkspace>[0]);

    expect(
      second.validateBuildAndRunLegacyWorkspaceMigration,
    ).not.toHaveBeenCalled();
  });
});
