import { NavigationButton } from '@/ui/input/components/NavigationButton';

import { isDDLLockedState } from '@/client-config/states/isDDLLockedState';
import { useFilteredObjectMetadataItems } from '@/object-metadata/hooks/useFilteredObjectMetadataItems';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsDiscoveryHeroCard } from '@/settings/components/SettingsDiscoveryHeroCard';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import DarkCoverImage from '@/settings/data-model/assets/cover-dark.png';
import LightCoverImage from '@/settings/data-model/assets/cover-light.png';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { IconEye, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/primitives/input';
import { SettingsObjectTable } from '~/pages/settings/data-model/SettingsObjectTable';

export const SettingsObjects = () => {
  const { t } = useLingui();

  const { objectMetadataItems } = useFilteredObjectMetadataItems();
  const isDDLLocked = useAtomStateValue(isDDLLockedState);

  return (
    <SettingsPageLayout
      title={t`Data model`}
      actionButton={
        isDDLLocked ? (
          <Button
            startIcon={<IconPlus />}
            size="sm"
            disabled
            variant="solid"
            color="accent"
          >{t`Add object`}</Button>
        ) : (
          <NavigationButton
            to={getSettingsPath(SettingsPath.NewObject)}
            startIcon={<IconPlus />}
            size="sm"
            variant="solid"
            color="accent"
          >{t`Add object`}</NavigationButton>
        )
      }
      links={[
        {
          children: t`Workspace`,
          href: getSettingsPath(SettingsPath.General),
        },
        { children: t`Objects` },
      ]}
    >
      <SettingsPageContainer>
        <Section.Root>
          <SettingsDiscoveryHeroCard
            lightSrc={LightCoverImage}
            darkSrc={DarkCoverImage}
          />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Objects`}
            description={t`Manage objects, fields and relationships`}
          />
          <SettingsObjectTable objectMetadataItems={objectMetadataItems} />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Visualize data model`}
            description={t`See your data structure as an interactive diagram`}
          />
          <NavigationButton
            to={getSettingsPath(SettingsPath.ObjectOverview)}
            size="md"
            startIcon={<IconEye />}
            variant="outline"
          >{t`Visualize`}</NavigationButton>
        </Section.Root>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
