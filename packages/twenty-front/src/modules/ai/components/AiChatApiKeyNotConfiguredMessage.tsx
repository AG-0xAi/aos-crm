import { InlineBanner } from 'twenty-ui/components/feedback';
import { AiChatInlineBanner } from '@/ai/components/AiChatInlineBanner';
import { useHelpCenterUrl } from '@/support/hooks/useHelpCenterUrl';
import { t } from '@lingui/core/macro';
import { DOCUMENTATION_PATHS } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { IconExternalLink } from 'twenty-ui/icon';
import { openUrlInNewTab } from '~/utils/openUrlInNewTab';

export const AiChatApiKeyNotConfiguredMessage = () => {
  const docsUrl = useHelpCenterUrl(
    DOCUMENTATION_PATHS.DEVELOPERS_SELF_HOST_CAPABILITIES_SETUP,
  );

  return (
    <AiChatInlineBanner
      action={
        isDefined(docsUrl) ? (
          <InlineBanner.Action
            startIcon={<IconExternalLink />}
            onClick={() => openUrlInNewTab(docsUrl)}
          >{t`View Docs`}</InlineBanner.Action>
        ) : undefined
      }
    >{t`Add an API key to enable AI.`}</AiChatInlineBanner>
  );
};
