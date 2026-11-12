import { SignupWebhookJob } from 'src/engine/core-modules/signup-webhook/jobs/signup-webhook.job';
import { type SignupWebhookJobData } from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const DATA: SignupWebhookJobData = {
  event: 'user.signed_up',
  email: 'ana@example.test',
  firstName: 'Ana',
  lastName: 'Lopez',
  locale: 'en',
  workspace: { subdomain: 'ana-co', displayName: 'Ana Co' },
  via: 'other',
  occurredAt: '2026-11-09T00:00:00.000Z',
  app: 'betty',
  appVersion: '1.2.3',
};

const httpError = (status?: number) => {
  const error = new Error('request failed') as Error & {
    response?: { status: number };
  };

  if (status !== undefined) {
    error.response = { status };
  }

  return error;
};

const buildJob = (
  post: jest.Mock,
  {
    webhookUrl = 'https://founder.example.test/hooks/signup',
  }: { webhookUrl?: string } = {},
) => {
  const secureHttpClientService = {
    getHttpClient: jest.fn(() => ({ post })),
  };
  const twentyConfigService = {
    get: jest.fn((key: string) =>
      key === 'SIGNUP_WEBHOOK_URL' ? webhookUrl : undefined,
    ),
  } as unknown as TwentyConfigService;

  return new SignupWebhookJob(
    secureHttpClientService as never,
    twentyConfigService,
  );
};

describe('SignupWebhookJob', () => {
  it('POSTs the full job data (no webhook url in it) as JSON, to the url read from config', async () => {
    const post = jest.fn(async () => ({ status: 200 }));
    const job = buildJob(post);

    await job.handle(DATA);

    expect(DATA).not.toHaveProperty('webhookUrl');
    expect(post).toHaveBeenCalledWith(
      'https://founder.example.test/hooks/signup',
      DATA,
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      }),
    );
  });

  it('does nothing when SIGNUP_WEBHOOK_URL is empty', async () => {
    const post = jest.fn();
    const job = buildJob(post, { webhookUrl: '' });

    await job.handle(DATA);

    expect(post).not.toHaveBeenCalled();
  });

  it('retries (rethrows) on a 5xx response', async () => {
    const post = jest.fn(async () => {
      throw httpError(503);
    });
    const job = buildJob(post);

    await expect(job.handle(DATA)).rejects.toThrow();
  });

  it('retries (rethrows) on a network failure with no response', async () => {
    const post = jest.fn(async () => {
      throw httpError();
    });
    const job = buildJob(post);

    await expect(job.handle(DATA)).rejects.toThrow();
  });

  it('does not retry a 4xx response', async () => {
    const post = jest.fn(async () => {
      throw httpError(400);
    });
    const job = buildJob(post);

    await expect(job.handle(DATA)).resolves.toBeUndefined();
  });
});
