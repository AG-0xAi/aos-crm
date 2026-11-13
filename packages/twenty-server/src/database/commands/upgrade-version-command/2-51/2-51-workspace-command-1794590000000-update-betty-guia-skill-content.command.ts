import { Command } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_SKILL } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-skill.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const BETTY_GUIA_UNIVERSAL_IDENTIFIER =
  STANDARD_SKILL['betty-guia'].universalIdentifier;

@RegisteredWorkspaceCommand('2.51.0', 1794590000000)
@Command({
  name: 'upgrade:2-51:update-betty-guia-skill-content',
  description:
    'Rewrite the content of the betty-guia standard skill ("Conóceme") in workspaces that already have it, so it stops asking the assistant to look up the profile note itself',
})
export class UpdateBettyGuiaSkillContentCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const { flatSkillMaps: existingFlatSkillMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatSkillMaps',
      ]);

    const existingBettyGuiaSkill =
      existingFlatSkillMaps.byUniversalIdentifier[
        BETTY_GUIA_UNIVERSAL_IDENTIFIER
      ];

    if (!isDefined(existingBettyGuiaSkill)) {
      this.logger.log(
        `Workspace ${workspaceId} does not have betty-guia yet, skipping`,
      );

      return;
    }

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });

    const standardBettyGuiaSkill = findFlatEntityByUniversalIdentifier({
      universalIdentifier: BETTY_GUIA_UNIVERSAL_IDENTIFIER,
      flatEntityMaps: standardAllFlatEntityMaps.flatSkillMaps,
    });

    if (!isDefined(standardBettyGuiaSkill)) {
      throw new Error('betty-guia standard skill missing from the catalog');
    }

    if (existingBettyGuiaSkill.content === standardBettyGuiaSkill.content) {
      this.logger.log(
        `Workspace ${workspaceId}: betty-guia content already up to date, skipping`,
      );

      return;
    }

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Workspace ${workspaceId}: would update the betty-guia skill content`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            skill: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: [
                {
                  ...existingBettyGuiaSkill,
                  content: standardBettyGuiaSkill.content,
                },
              ],
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to update betty-guia skill content:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );

      throw new Error(
        `Failed to update betty-guia skill content for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Workspace ${workspaceId}: updated the betty-guia skill content`,
    );
  }
}
