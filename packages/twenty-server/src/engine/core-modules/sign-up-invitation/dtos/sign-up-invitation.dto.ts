import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { SignUpInvitationStatusEnum } from 'src/engine/core-modules/sign-up-invitation/enums/sign-up-invitation-status.enum';

// No token field, by design: the plaintext exists only in the e-mail, and the
// database keeps a sha256 of it.
@ObjectType('SignUpInvitation')
export class SignUpInvitationDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field()
  email: string;

  @Field(() => SignUpInvitationStatusEnum)
  status: SignUpInvitationStatusEnum;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => Date, { nullable: true })
  consumedAt: Date | null;

  @Field(() => Date, { nullable: true })
  revokedAt: Date | null;
}
