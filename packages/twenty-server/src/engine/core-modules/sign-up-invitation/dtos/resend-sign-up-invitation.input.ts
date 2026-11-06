import { ArgsType, Field } from '@nestjs/graphql';

import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { type APP_LOCALES } from 'twenty-shared/translations';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ArgsType()
export class ResendSignUpInvitationInput {
  @Field(() => UUIDScalarType)
  @IsNotEmpty()
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  locale?: keyof typeof APP_LOCALES;
}
