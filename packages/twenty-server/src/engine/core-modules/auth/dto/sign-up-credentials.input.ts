import { ArgsType, Field } from '@nestjs/graphql';

import { IsOptional, IsString } from 'class-validator';

import { UserCredentialsInput } from 'src/engine/core-modules/auth/dto/user-credentials.input';

// Its own ArgsType rather than a field on UserCredentialsInput: that one is
// also the argument list of signIn and getLoginTokenFromCredentials, and
// neither has any use for a sign-up invitation.
@ArgsType()
export class SignUpCredentialsInput extends UserCredentialsInput {
  // CRM-016: the operator's sign-up invitation, carried by the e-mailed link.
  // Without it, a restricted instance refuses a sign-up that has no workspace
  // to land in.
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  signUpInvitationToken?: string;
}
