import { registerEnumType } from '@nestjs/graphql';

export enum SignUpInvitationStatusEnum {
  Pending = 'PENDING',
  Used = 'USED',
  Expired = 'EXPIRED',
  Revoked = 'REVOKED',
}

registerEnumType(SignUpInvitationStatusEnum, {
  name: 'SignUpInvitationStatus',
});
