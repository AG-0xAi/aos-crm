import { SignupWebhookJob } from 'src/engine/core-modules/signup-webhook/jobs/signup-webhook.job';
import { type SignupWebhookJobData } from 'src/engine/core-modules/signup-webhook/types/signup-webhook-event.type';

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
  webhookUrl: 'https://founder.example.test/hooks/signup',
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

const buildJob = (post: jest.Mock) => {
  const secureHttpClientService = {
    getHttpClient: jest.fn(() => ({ post })),
  };

  return new SignupWebhookJob(secureHttpClientService as never);
};

describe('SignupWebhookJob', () => {
  it('POSTs the payload without the webhook url as JSON', async () => {
    const post = jest.fn(async () => ({ status: 200 }));
    const job = buildJob(post);

    await job.handle(DATA);

    const { webhookUrl, ...payload } = DATA;

    expect(post).toHaveBeenCalledWith(
      webhookUrl,
      payload,
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      }),
    );
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
