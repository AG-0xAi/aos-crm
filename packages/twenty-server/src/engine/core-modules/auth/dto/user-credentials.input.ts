import { ArgsType, Field } from '@nestjs/graphql';

import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { type APP_LOCALES } from 'twenty-shared/translations';

@ArgsType()
export class UserCredentialsInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  password: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  captchaToken?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  locale?: keyof typeof APP_LOCALES;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  verifyEmailRedirectPath?: string;

  // CRM-016: the operator's sign-up invitation, carried by the e-mailed link.
  // Without it, a restricted instance refuses a sign-up that has no workspace
  // to land in.
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  signUpInvitationToken?: string;
}
