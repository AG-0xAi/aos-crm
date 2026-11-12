import { Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { type SignupWebhookJobData } from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const SIGNUP_WEBHOOK_TIMEOUT_MS = 10_000;

@Processor(MessageQueue.webhookQueue)
export class SignupWebhookJob {
  private readonly logger = new Logger(SignupWebhookJob.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Process(SignupWebhookJob.name)
  async handle(data: SignupWebhookJobData): Promise<void> {
    const webhookUrl = this.twentyConfigService.get('SIGNUP_WEBHOOK_URL');

    if (!isNonEmptyString(webhookUrl)) {
      this.logger.debug(
        `Skipping signup webhook delivery for event ${data.event}: SIGNUP_WEBHOOK_URL is empty`,
      );

      return;
    }

    try {
      const axiosClient = this.secureHttpClientService.getHttpClient();

      // Jobs queued before CRM-036 still carry the URL in their data; never
      // echo it back in the request body.
      const { webhookUrl: _legacyWebhookUrl, ...payload } =
        data as SignupWebhookJobData & {
          webhookUrl?: string;
        };

      await axiosClient.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: SIGNUP_WEBHOOK_TIMEOUT_MS,
      });
    } catch (error) {
      const status = error.response?.status;
      // 4xx means the operator's workflow rejected this payload: retrying it
      // would not change the outcome, so only 5xx/network failures retry.
      const isRetryable = !isDefined(status) || status >= 500;

      this.logger.error(
        `Signup webhook delivery failed for event ${data.event}${isDefined(status) ? ` (status ${status})` : ''}`,
      );

      if (isRetryable) {
        throw error;
      }
    }
  }
}
