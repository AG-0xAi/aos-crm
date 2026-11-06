import { useSignUpInvitations } from '@/settings/admin-panel/sign-up-invitations/hooks/useSignUpInvitations';
import { SettingsSectionSkeletonLoader } from '@/settings/components/SettingsSectionSkeletonLoader';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { Table } from '@/ui/layout/table/components/Table';
import { TableBody } from '@/ui/layout/table/components/TableBody';
import { TableCell } from '@/ui/layout/table/components/TableCell';
import { TableHeader } from '@/ui/layout/table/components/TableHeader';
import { TableRow } from '@/ui/layout/table/components/TableRow';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { Tag, type TagColor } from 'twenty-ui/primitives/data-display';
import { Button } from 'twenty-ui/primitives/input';
import { OverflowingTextWithTooltip } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';
import { SignUpInvitationStatus } from '~/generated-admin/graphql';
import {
  beautifyExactDateTime,
  beautifyPastDateRelativeToNow,
} from '~/utils/date-utils';

const INVITATIONS_GRID_TEMPLATE_COLUMNS = '2fr 96px 1fr 160px';

const StyledEmptyState = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  padding: ${themeCssVariables.spacing[4]} 0;
`;

const StyledInviteRow = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding-bottom: ${themeCssVariables.spacing[2]};
`;

const StyledInviteField = styled.div`
  flex-grow: 1;
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: flex-end;
`;

// A function and not a module-level map: the `t` macro resolves when it runs,
// and at module scope it would freeze the source locale at import time.
const getStatusTag = (
  status: SignUpInvitationStatus,
): { text: string; color: TagColor } => {
  switch (status) {
    case SignUpInvitationStatus.Pending:
      return { text: t`Pending`, color: 'blue' };
    case SignUpInvitationStatus.Used:
      return { text: t`Used`, color: 'green' };
    case SignUpInvitationStatus.Revoked:
      return { text: t`Revoked`, color: 'red' };
    default:
      return { text: t`Expired`, color: 'gray' };
  }
};

export const SettingsAdminSignUpInvitations = () => {
  const [email, setEmail] = useState('');
  const {
    invitations,
    loading,
    error,
    pendingInvitationId,
    createInvitation,
    resendInvitation,
    revokeInvitation,
  } = useSignUpInvitations();

  const handleInvite = async () => {
    const trimmedEmail = email.trim();

    if (trimmedEmail === '') {
      return;
    }

    if (await createInvitation(trimmedEmail)) {
      setEmail('');
    }
  };

  return (
    <Section.Root>
      <Section.Header
        title={t`Sign-up invitations`}
        description={t`Add an address and that person gets a single-use link to create their own account and workspace. The link expires in seven days; revoking it stops it working.`}
      />
      <StyledInviteRow>
        <StyledInviteField>
          <SettingsTextInput
            instanceId="admin-panel-sign-up-invitation-email"
            value={email}
            onChange={setEmail}
            onInputEnter={handleInvite}
            placeholder={t`name@example.com`}
            fullWidth
          />
        </StyledInviteField>
        <Button
          onClick={handleInvite}
          disabled={email.trim() === ''}
          variant="solid"
          color="accent"
        >{t`Invite`}</Button>
      </StyledInviteRow>
      {loading ? (
        <SettingsSectionSkeletonLoader />
      ) : isDefined(error) ? (
        <StyledEmptyState>{t`Failed to load sign-up invitations.`}</StyledEmptyState>
      ) : invitations.length === 0 ? (
        <StyledEmptyState>{t`No sign-up invitations yet.`}</StyledEmptyState>
      ) : (
        <Table>
          <TableRow gridTemplateColumns={INVITATIONS_GRID_TEMPLATE_COLUMNS}>
            <TableHeader>{t`Address`}</TableHeader>
            <TableHeader>{t`Status`}</TableHeader>
            <TableHeader>{t`Expires`}</TableHeader>
            <TableHeader />
          </TableRow>
          <TableBody>
            {invitations.map((invitation) => {
              const status = getStatusTag(invitation.status);
              const isLive =
                invitation.status === SignUpInvitationStatus.Pending ||
                invitation.status === SignUpInvitationStatus.Expired;
              const isBusy = pendingInvitationId === invitation.id;

              return (
                <TableRow
                  key={invitation.id}
                  gridTemplateColumns={INVITATIONS_GRID_TEMPLATE_COLUMNS}
                >
                  <TableCell
                    color={themeCssVariables.font.color.primary}
                    overflow="hidden"
                  >
                    <OverflowingTextWithTooltip
                      text={invitation.email}
                      tooltipContent={t`Invited on ${beautifyExactDateTime(invitation.createdAt)}`}
                      alwaysShowTooltip
                    />
                  </TableCell>
                  <TableCell>
                    <Tag color={status.color}>{status.text}</Tag>
                  </TableCell>
                  <TableCell overflow="hidden">
                    <OverflowingTextWithTooltip
                      text={
                        invitation.status === SignUpInvitationStatus.Used &&
                        isDefined(invitation.consumedAt)
                          ? beautifyPastDateRelativeToNow(invitation.consumedAt)
                          : beautifyExactDateTime(invitation.expiresAt)
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <StyledActions>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isLive || isBusy}
                        onClick={() => resendInvitation(invitation.id)}
                      >{t`Resend`}</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        color="danger"
                        disabled={!isLive || isBusy}
                        onClick={() => revokeInvitation(invitation.id)}
                      >{t`Revoke`}</Button>
                    </StyledActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section.Root>
  );
};
