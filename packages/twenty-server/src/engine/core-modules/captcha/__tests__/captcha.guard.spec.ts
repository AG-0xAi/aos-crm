import { type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { CaptchaDriverFactory } from 'src/engine/core-modules/captcha/captcha-driver.factory';
import { CaptchaException } from 'src/engine/core-modules/captcha/captcha.exception';
import { CaptchaGuard } from 'src/engine/core-modules/captcha/captcha.guard';
import { CaptchaService } from 'src/engine/core-modules/captcha/captcha.service';
import { CaptchaDriverType } from 'src/engine/core-modules/captcha/interfaces';
import { MetricsKeys } from 'src/engine/core-modules/metrics/types/metrics-keys.type';

// Exercises the real guard -> service -> factory -> TurnstileDriver chain
// (CRM-042). Only the HTTP boundary (axios' post, stood in by mockPost) is
// mocked, never CaptchaService itself, so a passing test here means the
// driver's own request/response handling was exercised, not assumed.
describe('CaptchaGuard (CRM-042 anti-bot sign-up)', () => {
  const mockPost = jest.fn();
  const twentyConfigService = { get: jest.fn() };
  const configGroupHashService = {
    computeHash: jest.fn().mockReturnValue('hash'),
  };
  const secureHttpClientService = {
    getHttpClient: jest.fn().mockReturnValue({ post: mockPost }),
  };
  const metricsService = { incrementCounterForEvent: jest.fn() };

  let guard: CaptchaGuard;

  beforeEach(() => {
    jest.clearAllMocks();

    const driverFactory = new CaptchaDriverFactory(
      twentyConfigService as any,
      configGroupHashService as any,
      secureHttpClientService as any,
    );
    const captchaService = new CaptchaService(driverFactory);

    guard = new CaptchaGuard(captchaService as any, metricsService as any);
  });

  const buildContext = (captchaToken: string | undefined) => {
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getArgs: () => ({ captchaToken }),
    } as any);

    return {} as ExecutionContext;
  };

  it("lets a sign-up with no token through unchanged when CAPTCHA_DRIVER is off (today's default)", async () => {
    twentyConfigService.get.mockReturnValue(undefined);

    const result = await guard.canActivate(buildContext(undefined));

    expect(result).toBe(true);
    expect(secureHttpClientService.getHttpClient).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('refuses a sign-up with a missing token once CAPTCHA_DRIVER=TURNSTILE', async () => {
    twentyConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'CAPTCHA_DRIVER':
          return CaptchaDriverType.TURNSTILE;
        case 'CAPTCHA_SITE_KEY':
          return 'site-key';
        case 'CAPTCHA_SECRET_KEY':
          return 'secret-key';
        default:
          return undefined;
      }
    });
    mockPost.mockResolvedValue({
      data: { success: false, 'error-codes': ['missing-input-response'] },
    });

    await expect(guard.canActivate(buildContext(undefined))).rejects.toThrow(
      CaptchaException,
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(metricsService.incrementCounterForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ key: MetricsKeys.InvalidCaptcha }),
    );
  });

  it('refuses a sign-up with an invalid token once CAPTCHA_DRIVER=TURNSTILE', async () => {
    twentyConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'CAPTCHA_DRIVER':
          return CaptchaDriverType.TURNSTILE;
        case 'CAPTCHA_SITE_KEY':
          return 'site-key';
        case 'CAPTCHA_SECRET_KEY':
          return 'secret-key';
        default:
          return undefined;
      }
    });
    mockPost.mockResolvedValue({
      data: { success: false, 'error-codes': ['invalid-input-response'] },
    });

    await expect(
      guard.canActivate(buildContext('a-bot-sent-this-token')),
    ).rejects.toThrow(CaptchaException);

    const [, body] = mockPost.mock.calls[0];

    expect(body.get('response')).toBe('a-bot-sent-this-token');
    expect(body.get('secret')).toBe('secret-key');
  });

  it('lets a sign-up with a valid token through once CAPTCHA_DRIVER=TURNSTILE', async () => {
    twentyConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'CAPTCHA_DRIVER':
          return CaptchaDriverType.TURNSTILE;
        case 'CAPTCHA_SITE_KEY':
          return 'site-key';
        case 'CAPTCHA_SECRET_KEY':
          return 'secret-key';
        default:
          return undefined;
      }
    });
    mockPost.mockResolvedValue({ data: { success: true } });

    const result = await guard.canActivate(buildContext('a-real-human-token'));

    expect(result).toBe(true);
  });
});
