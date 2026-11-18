import { z } from 'zod';

import { BETTY_TEMPLATES } from 'src/engine/api/mcp/constants/betty-template-catalog.constant';
import { getBettyTemplateState } from 'src/engine/api/mcp/utils/get-betty-template-state.util';
import { type ApplicationLookupService } from 'src/engine/core-modules/application/application-lookup/application-lookup.service';
import { type ApplicationRegistrationLookupService } from 'src/engine/core-modules/application/application-registration/application-registration-lookup/application-registration-lookup.service';

export const LIST_TEMPLATES_TOOL_NAME = 'list_templates';

export const listTemplatesInputSchema = z.object({});

export type ListTemplatesResult = {
  templates: {
    id: string;
    title: string;
    description: { es: string; en: string };
    entryPoints: string[];
    installed: boolean;
  }[];
};

export const createListTemplatesTool = ({
  workspaceId,
  applicationRegistrationLookupService,
  applicationLookupService,
}: {
  workspaceId: string;
  applicationRegistrationLookupService: ApplicationRegistrationLookupService;
  applicationLookupService: ApplicationLookupService;
}) => ({
  description:
    "List the Betty templates (ready-made apps such as Finanzas) available on this server, each with installed true/false for the caller's workspace. Read-only. A template that is not registered on the server is never listed, so never offer one that does not appear here. Call it before offering a template, for example when the person asks to organize their finances.",
  inputSchema: listTemplatesInputSchema,
  execute: async (): Promise<ListTemplatesResult> => {
    const states = await Promise.all(
      BETTY_TEMPLATES.map((template) =>
        getBettyTemplateState({
          template,
          workspaceId,
          applicationRegistrationLookupService,
          applicationLookupService,
        }),
      ),
    );

    return {
      templates: BETTY_TEMPLATES.flatMap((template, index) =>
        states[index].isRegistered
          ? [
              {
                id: template.id,
                title: template.title,
                description: template.description,
                entryPoints: template.entryPoints,
                installed: states[index].isInstalled,
              },
            ]
          : [],
      ),
    };
  },
});
