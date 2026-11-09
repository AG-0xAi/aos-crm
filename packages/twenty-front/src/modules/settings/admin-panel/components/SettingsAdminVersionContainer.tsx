import { SettingsTableCard } from '@/settings/components/SettingsTableCard';
import { useApolloAdminClient } from '@/settings/admin-panel/apollo/hooks/useApolloAdminClient';
import { SettingsAdminVersionDisplay } from '@/settings/admin-panel/components/SettingsAdminVersionDisplay';
import { t } from '@lingui/core/macro';
import { IconCircleDot, IconVersions } from 'twenty-ui/icon';
import { useQuery } from '@apollo/client/react';
import { GetVersionInfoDocument } from '~/generated-admin/graphql';

// Bump this when the fork re-syncs its base with a newer Twenty upstream tag.
const UPSTREAM_TWENTY_VERSION = 'Twenty v2.51.0';

export const SettingsAdminVersionContainer = () => {
  const apolloAdminClient = useApolloAdminClient();
  const { data, loading } = useQuery(GetVersionInfoDocument, {
    client: apolloAdminClient,
  });
  const { currentVersion } = data?.versionInfo ?? {};

  const versionItems = [
    {
      Icon: IconCircleDot,
      label: t`Betty version`,
      value: (
        <SettingsAdminVersionDisplay
          version={currentVersion}
          loading={loading}
          noVersionMessage={t`Unknown`}
        />
      ),
    },
    {
      Icon: IconVersions,
      label: t`Based on`,
      value: (
        <SettingsAdminVersionDisplay
          version={UPSTREAM_TWENTY_VERSION}
          loading={false}
          noVersionMessage={t`Unknown`}
        />
      ),
    },
  ];

  return <SettingsTableCard items={versionItems} gridAutoColumns="3fr 8fr" />;
};
