import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { BRAND_NAME } from 'twenty-shared/constants';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath, isDefined } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { themeCssVariables } from 'twenty-ui/theme';

import { appVersionState } from '@/client-config/states/appVersionState';
import { sourceCodeUrlState } from '@/client-config/states/sourceCodeUrlState';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

// The full text of the AGPL-3.0, published by the Free Software Foundation.
// Not brand-specific, so it is not in twenty-shared/constants with the brand
// URLs.
const AGPL_LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

const StyledLink = styled.a`
  color: ${themeCssVariables.font.color.primary};
  text-decoration: underline;
`;

export const SettingsAbout = () => {
  const appVersion = useAtomStateValue(appVersionState);
  const sourceCodeUrl = useAtomStateValue(sourceCodeUrlState);

  const version = isDefined(appVersion) ? appVersion : t`version not reported`;

  return (
    <SettingsPageLayout
      title={t`About Betty`}
      links={[
        { children: t`Other`, href: getSettingsPath(SettingsPath.About) },
        { children: t`About Betty` },
      ]}
    >
      <SettingsPageContainer>
        <Section.Root>
          <Section.Header
            title={BRAND_NAME}
            description={`${t`Version`} ${version}`}
          />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`License`}
            description={t`Betty is free software under the GNU AGPL-3.0.`}
          />
          <StyledLink
            href={AGPL_LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t`Read the license`}
          </StyledLink>
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Source code`}
            description={
              isDefined(sourceCodeUrl) ? (
                <StyledLink
                  href={sourceCodeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t`Source code (${version})`}
                </StyledLink>
              ) : (
                t`source code link not configured on this server (${version})`
              )
            }
          />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Credits`}
            description={t`Betty is based on Twenty (twentyhq/twenty), licensed under the GNU AGPL-3.0, with some files under a commercial license.`}
          />
        </Section.Root>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
