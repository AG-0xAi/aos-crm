import { USER_SIGNUP_EVENT_NAME } from 'src/engine/api/graphql/workspace-query-runner/constants/user-signup-event-name.constants';
import type { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TelemetryService } from 'src/engine/core-modules/telemetry/telemetry.service';
import type { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// CRM-003 (AOS-CRM): proves the no-send contract documented in
// docs/aos/bootstrap/TELEMETRY_AUDIT.md -- when TELEMETRY_ENABLED is false,
// publish() never creates an HTTP client and never calls .post(...), with a
// spy standing in for the real axios instance (no network involved either
// way). The second test proves the same spy DOES see a request when the
// flag is true, so the first assertion is not vacuously passing.
describe('TelemetryService', () => {
  const samplePayload = {
    action: USER_SIGNUP_EVENT_NAME,
    events: [
      {
        userId: 'user-id',
        serverUrl: 'http://127.0.0.1:43000',
        serverId: 'server-id',
      },
    ],
  };

  const buildService = (telemetryEnabled: boolean) => {
    const postMock = jest.fn().mockResolvedValue({ data: {} });
    const getHttpClient = jest.fn().mockReturnValue({ post: postMock });
    const twentyConfigService = {
      get: jest.fn().mockReturnValue(telemetryEnabled),
    } as unknown as TwentyConfigService;
    const secureHttpClientService = {
      getHttpClient,
    } as unknown as SecureHttpClientService;

    const service = new TelemetryService(
      twentyConfigService,
      secureHttpClientService,
    );

    return { service, getHttpClient, postMock, twentyConfigService };
  };

  it('never creates an HTTP client or sends a request when TELEMETRY_ENABLED is false', async () => {
    const { service, getHttpClient, postMock, twentyConfigService } =
      buildService(false);

    const result = await service.publish(samplePayload);

    expect(result).toEqual({ success: true });
    expect(getHttpClient).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
    expect(twentyConfigService.get).toHaveBeenCalledWith('TELEMETRY_ENABLED');
  });

  it('sanity check: the same spy DOES see a request when TELEMETRY_ENABLED is true, so the test above is not vacuous', async () => {
    const { service, getHttpClient, postMock } = buildService(true);

    const result = await service.publish(samplePayload);

    expect(result).toEqual({ success: true });
    expect(getHttpClient).toHaveBeenCalledWith({
      baseURL: 'https://twenty-telemetry.com/api/v2',
    });
    expect(postMock).toHaveBeenCalledWith(
      '/selfHostingEvent',
      expect.objectContaining({ action: USER_SIGNUP_EVENT_NAME }),
    );
  });
});
