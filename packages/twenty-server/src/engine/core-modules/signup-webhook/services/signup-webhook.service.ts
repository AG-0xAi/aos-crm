import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SignupWebhookJob } from 'src/engine/core-modules/signup-webhook/jobs/signup-webhook.job';
import {
  type SignupWebhookJobData,
  type SignupWebhookPayload,
} from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const SIGNUP_WEBHOOK_RETRY_LIMIT = 3;
const SIGNUP_WEBHOOK_BACKOFF_INITIAL_DELAY_MS = 1_000;

@Injectable()
export class SignupWebhookService {
  private readonly logger = new Logger(SignupWebhookService.name);

  constructor(
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  // Never throws: a failure here must never fail the sign-up or invitation
  // it is reporting on.
  async enqueue(payload: SignupWebhookPayload): Promise<void> {
    const webhookUrl = this.twentyConfigService.get('SIGNUP_WEBHOOK_URL');

    if (!isNonEmptyString(webhookUrl)) {
      return;
    }

    const data: SignupWebhookJobData = {
      ...payload,
      occurredAt: new Date().toISOString(),
      app: 'betty',
      appVersion: this.twentyConfigService.get('APP_VERSION') ?? 'unknown',
      webhookUrl,
    };

    try {
      await this.messageQueueService.add<SignupWebhookJobData>(
        SignupWebhookJob.name,
        data,
        {
          retryLimit: SIGNUP_WEBHOOK_RETRY_LIMIT,
          backoff: {
            strategy: 'exponential',
            initialDelayMilliseconds: SIGNUP_WEBHOOK_BACKOFF_INITIAL_DELAY_MS,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue signup webhook event ${payload.event}`,
        error,
      );
    }
  }
}
