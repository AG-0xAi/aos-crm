import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { WorkspaceDomainsModule } from 'src/engine/core-modules/domain/workspace-domains/workspace-domains.module';
import { SignUpInvitationService } from 'src/engine/core-modules/sign-up-invitation/services/sign-up-invitation.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppTokenEntity]), WorkspaceDomainsModule],
  providers: [SignUpInvitationService],
  exports: [SignUpInvitationService],
})
export class SignUpInvitationModule {}
