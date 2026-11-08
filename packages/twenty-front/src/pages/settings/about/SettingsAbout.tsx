import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { BRAND_NAME } from 'twenty-shared/constants';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath, isDefined } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { Text } from 'twenty-ui/primitives/typography';
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
            description={t`Version ${version}`}
          />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`License and source code`}
            description={t`Betty is a product of AOS Holding. Its CRM is built on Twenty, an open-source project licensed under the GNU AGPL-3.0. The changes we make to that CRM are published under the same license.`}
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
          <Text>{t`Betty's services that are not part of the CRM, such as the assistant, billing and integrations, are proprietary software of AOS Holding.`}</Text>
        </Section.Root>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
