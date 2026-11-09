import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { type SignupWebhookJobData } from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';

const SIGNUP_WEBHOOK_TIMEOUT_MS = 10_000;

@Processor(MessageQueue.webhookQueue)
export class SignupWebhookJob {
  private readonly logger = new Logger(SignupWebhookJob.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  @Process(SignupWebhookJob.name)
  async handle(data: SignupWebhookJobData): Promise<void> {
    const { webhookUrl, ...payload } = data;

    try {
      const axiosClient = this.secureHttpClientService.getHttpClient();

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
        `Signup webhook delivery failed for event ${payload.event}${isDefined(status) ? ` (status ${status})` : ''}`,
      );

      if (isRetryable) {
        throw error;
      }
    }
  }
}
