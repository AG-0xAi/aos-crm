import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { SignupWebhookJob } from 'src/engine/core-modules/signup-webhook/jobs/signup-webhook.job';
import { SignupWebhookService } from 'src/engine/core-modules/signup-webhook/services/signup-webhook.service';

@Module({
  imports: [SecureHttpClientModule],
  providers: [SignupWebhookJob, SignupWebhookService],
  exports: [SignupWebhookService],
})
export class SignupWebhookModule {}
