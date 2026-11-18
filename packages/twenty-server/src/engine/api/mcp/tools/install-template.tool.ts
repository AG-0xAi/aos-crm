import { Logger } from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';
import { z } from 'zod';

import { findBettyTemplate } from 'src/engine/api/mcp/constants/betty-template-catalog.constant';
import { getBettyTemplateState } from 'src/engine/api/mcp/utils/get-betty-template-state.util';
import { type ApplicationInstallService } from 'src/engine/core-modules/application/application-install/application-install.service';
import { type ApplicationLookupService } from 'src/engine/core-modules/application/application-lookup/application-lookup.service';
import { type ApplicationRegistrationLookupService } from 'src/engine/core-modules/application/application-registration/application-registration-lookup/application-registration-lookup.service';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

const logger = new Logger('InstallTemplateTool');

export const INSTALL_TEMPLATE_TOOL_NAME = 'install_template';

export const installTemplateInputSchema = z.object({
  templateId: z
    .string()
    .describe('The id of a template returned by list_templates'),
});

export type InstallTemplateResult =
  | {
      success: true;
      status: 'installed';
      entryPoints: string[];
      minimumSetup: string;
    }
  | { success: true; status: 'already_installed'; entryPoints: string[] }
  | {
      success: false;
      status: 'forbidden' | 'unknown_template' | 'failed';
      message: string;
    };

export type InstallTemplateCaller = {
  workspaceId: string;
  userWorkspaceId: string | undefined;
  apiKeyId: string | undefined;
  applicationId: string | undefined;
  agentId: string | undefined;
};

export const createInstallTemplateTool = ({
  caller,
  permissionsService,
  applicationInstallService,
  applicationRegistrationLookupService,
  applicationLookupService,
}: {
  caller: InstallTemplateCaller;
  permissionsService: PermissionsService;
  applicationInstallService: ApplicationInstallService;
  applicationRegistrationLookupService: ApplicationRegistrationLookupService;
  applicationLookupService: ApplicationLookupService;
}) => ({
  description:
    "Install a registered Betty template (e.g. finanzas) in the caller's own workspace. ONLY call it after the person explicitly agreed to install it in this conversation. Idempotent: a second call answers already_installed with the entry points. It needs the workspace role that can manage applications; if refused, tell the person, in their language, to ask whoever administers the workspace to activate it. After success, offer the two entryPoints and mention minimumSetup.",
  inputSchema: installTemplateInputSchema,
  execute: async ({
    templateId,
  }: z.infer<
    typeof installTemplateInputSchema
  >): Promise<InstallTemplateResult> => {
    const template = findBettyTemplate(templateId);

    if (!template) {
      return {
        success: false,
        status: 'unknown_template',
        message: `No template with id "${templateId}". Call list_templates to see the available ones.`,
      };
    }

    const hasPermission =
      await permissionsService.userHasWorkspaceSettingPermission({
        userWorkspaceId: caller.userWorkspaceId,
        workspaceId: caller.workspaceId,
        setting: PermissionFlagType.APPLICATIONS,
        apiKeyId: caller.apiKeyId,
        applicationId: caller.applicationId,
        agentId: caller.agentId,
      });

    if (!hasPermission) {
      return {
        success: false,
        status: 'forbidden',
        message:
          'Pídele a quien administra el espacio que la active. / Ask whoever administers the workspace to activate it.',
      };
    }

    const state = await getBettyTemplateState({
      template,
      workspaceId: caller.workspaceId,
      applicationRegistrationLookupService,
      applicationLookupService,
    });

    if (state.registrationId === null) {
      return {
        success: false,
        status: 'unknown_template',
        message: `The template "${templateId}" is not available on this server.`,
      };
    }

    if (state.isInstalled) {
      return {
        success: true,
        status: 'already_installed',
        entryPoints: template.entryPoints,
      };
    }

    try {
      await applicationInstallService.installApplication({
        appRegistrationId: state.registrationId,
        workspaceId: caller.workspaceId,
        hasUserApprovedCapabilities: true,
      });
    } catch (error) {
      logger.error(
        `Template ${templateId} install failed for workspace ${caller.workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        success: false,
        status: 'failed',
        message:
          'La plantilla no se pudo instalar y no debes decir que está activa. Inténtalo de nuevo más tarde. / The template could not be installed; do not say it is active. Try again later.',
      };
    }

    return {
      success: true,
      status: 'installed',
      entryPoints: template.entryPoints,
      minimumSetup: template.minimumSetup,
    };
  },
});
