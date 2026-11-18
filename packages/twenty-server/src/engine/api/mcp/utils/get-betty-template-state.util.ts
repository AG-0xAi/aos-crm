import { isDefined } from 'twenty-shared/utils';

import { type BettyTemplate } from 'src/engine/api/mcp/constants/betty-template-catalog.constant';
import { type ApplicationLookupService } from 'src/engine/core-modules/application/application-lookup/application-lookup.service';
import { type ApplicationRegistrationLookupService } from 'src/engine/core-modules/application/application-registration/application-registration-lookup/application-registration-lookup.service';

export type BettyTemplateState = {
  registrationId: string | null;
  isRegistered: boolean;
  isInstalled: boolean;
};

// An application row without a version is a half-finished install, so it
// does not count as installed (the install service sets the version last).
export const getBettyTemplateState = async ({
  template,
  workspaceId,
  applicationRegistrationLookupService,
  applicationLookupService,
}: {
  template: BettyTemplate;
  workspaceId: string;
  applicationRegistrationLookupService: ApplicationRegistrationLookupService;
  applicationLookupService: ApplicationLookupService;
}): Promise<BettyTemplateState> => {
  const registration =
    await applicationRegistrationLookupService.findOneByUniversalIdentifierGlobal(
      template.applicationUniversalIdentifier,
    );

  if (!isDefined(registration)) {
    return { registrationId: null, isRegistered: false, isInstalled: false };
  }

  const application = await applicationLookupService.findByUniversalIdentifier({
    universalIdentifier: template.applicationUniversalIdentifier,
    workspaceId,
  });

  return {
    registrationId: registration.id,
    isRegistered: true,
    isInstalled: isDefined(application?.version),
  };
};
