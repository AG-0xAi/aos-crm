import { ArgsType, Field } from '@nestjs/graphql';

import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { type APP_LOCALES } from 'twenty-shared/translations';

@ArgsType()
export class CreateSignUpInvitationInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsEmail()
  email: string;

  // The language of the invitation e-mail. The invited person has no account
  // yet, so there is no stored preference to read.
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  locale?: keyof typeof APP_LOCALES;
}
