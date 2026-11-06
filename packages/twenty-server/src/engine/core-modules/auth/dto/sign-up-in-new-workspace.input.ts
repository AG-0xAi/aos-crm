import { Field, InputType } from '@nestjs/graphql';

import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PARTNER_PATTERN } from 'twenty-shared/constants';

@InputType()
export class SignUpInNewWorkspaceInput {
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  displayName?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  subdomain?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  @Matches(PARTNER_PATTERN)
  partner?: string;

  // CRM-016: what lets a non-admin open their one workspace on an instance
  // where creation is restricted to server admins. Consumed on success.
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  signUpInvitationToken?: string;
}
