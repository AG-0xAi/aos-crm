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

@RegisteredWorkspaceCommand('2.51.0', 1794567508947)
@Command({
  name: 'upgrade:2-51:add-betty-guia-skill',
  description:
    'Add the betty-guia standard skill ("Conóceme") to workspaces created before it existed',
})
export class AddBettyGuiaSkillCommand extends ProvisionedWorkspaceCommandRunner {
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

    if (
      isDefined(
        existingFlatSkillMaps.byUniversalIdentifier[
          BETTY_GUIA_UNIVERSAL_IDENTIFIER
        ],
      )
    ) {
      this.logger.log(
        `Workspace ${workspaceId} already has betty-guia, skipping`,
      );

      return;
    }

    const takenNames = new Set(
      Object.values(existingFlatSkillMaps.byUniversalIdentifier)
        .filter(isDefined)
        .map((skill) => skill.name),
    );

    if (takenNames.has('betty-guia')) {
      this.logger.warn(
        `Workspace ${workspaceId} already has a skill named betty-guia; skipping`,
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

    const bettyGuiaStandardSkill = findFlatEntityByUniversalIdentifier({
      universalIdentifier: BETTY_GUIA_UNIVERSAL_IDENTIFIER,
      flatEntityMaps: standardAllFlatEntityMaps.flatSkillMaps,
    });

    if (!isDefined(bettyGuiaStandardSkill)) {
      throw new Error('betty-guia standard skill missing from the catalog');
    }

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Workspace ${workspaceId}: would create the betty-guia skill`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            skill: {
              flatEntityToCreate: [bettyGuiaStandardSkill],
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to add betty-guia skill:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );

      throw new Error(`Failed to add betty-guia skill for workspace ${workspaceId}`);
    }

    this.logger.log(`Workspace ${workspaceId}: created the betty-guia skill`);
  }
}
