import { SignupWebhookJob } from 'src/engine/core-modules/signup-webhook/jobs/signup-webhook.job';
import { SignupWebhookService } from 'src/engine/core-modules/signup-webhook/services/signup-webhook.service';
import { SIGNUP_INVITATION_CREATED_EVENT } from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const PAYLOAD = {
  event: SIGNUP_INVITATION_CREATED_EVENT,
  email: 'ana@example.test',
  locale: 'en',
  expiresAt: '2026-11-16T00:00:00.000Z',
} as const;

const buildService = ({
  webhookUrl = 'https://founder.example.test/hooks/signup',
}: { webhookUrl?: string } = {}) => {
  const messageQueueService = {
    add: jest.fn(async () => 'job-1'),
  };

  const twentyConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'SIGNUP_WEBHOOK_URL') return webhookUrl;
      if (key === 'APP_VERSION') return '1.2.3';

      return undefined;
    }),
  } as unknown as TwentyConfigService;

  const service = new SignupWebhookService(
    messageQueueService as never,
    twentyConfigService,
  );

  return { service, messageQueueService };
};

describe('SignupWebhookService', () => {
  it('enqueues nothing when SIGNUP_WEBHOOK_URL is empty', async () => {
    const { service, messageQueueService } = buildService({ webhookUrl: '' });

    await service.enqueue(PAYLOAD);

    expect(messageQueueService.add).not.toHaveBeenCalled();
  });

  it('enqueues the envelope with the configured url and retry policy', async () => {
    const { service, messageQueueService } = buildService();

    await service.enqueue(PAYLOAD);

    expect(messageQueueService.add).toHaveBeenCalledWith(
      SignupWebhookJob.name,
      {
        ...PAYLOAD,
        occurredAt: expect.any(String),
        app: 'betty',
        appVersion: '1.2.3',
        webhookUrl: 'https://founder.example.test/hooks/signup',
      },
      {
        retryLimit: 3,
        backoff: {
          strategy: 'exponential',
          initialDelayMilliseconds: 1_000,
        },
      },
    );
  });

  it('never throws when enqueueing fails', async () => {
    const { service, messageQueueService } = buildService();

    (messageQueueService.add as jest.Mock).mockRejectedValue(
      new Error('queue unavailable'),
    );

    await expect(service.enqueue(PAYLOAD)).resolves.toBeUndefined();
  });
});
