import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { BRAND_LICENSE_NAME } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme';

import { appVersionState } from '@/client-config/states/appVersionState';
import { sourceCodeUrlState } from '@/client-config/states/sourceCodeUrlState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

const StyledNotice = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin: 0;
  text-align: center;

  & > a {
    color: ${themeCssVariables.font.color.tertiary};
    text-decoration: underline;
  }
`;

// AGPL section 13: anyone interacting with this build over a network must be
// offered its source. The link is the deployment's own SOURCE_CODE_URL, so it
// can name the exact commit; when it is unset this says so rather than point at
// a repository that might not be what is running here.
export const LicenseNotice = () => {
  const { t } = useLingui();
  const appVersion = useAtomStateValue(appVersionState);
  const sourceCodeUrl = useAtomStateValue(sourceCodeUrlState);

  const version = isDefined(appVersion) ? appVersion : t`version not reported`;

  return (
    <StyledNotice>
      {isDefined(sourceCodeUrl) ? (
        <>
          {BRAND_LICENSE_NAME}
          {' · '}
          <a href={sourceCodeUrl} target="_blank" rel="noopener noreferrer">
            {t`Source code (${version})`}
          </a>
        </>
      ) : (
        <>
          {BRAND_LICENSE_NAME}
          {' · '}
          {t`source code link not configured on this server (${version})`}
        </>
      )}
    </StyledNotice>
  );
};
