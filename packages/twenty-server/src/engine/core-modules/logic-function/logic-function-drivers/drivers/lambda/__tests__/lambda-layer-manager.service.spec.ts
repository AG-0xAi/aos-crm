let mockLambdaSend: jest.Mock;
let mockGetSignedUrl: jest.Mock;

jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');

  return {
    ...actual,
    Lambda: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockLambdaSend(...args),
      middlewareStack: { add: jest.fn() },
    })),
  };
});

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');

  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import { type LambdaToolFunctionsService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-tool-functions.service';
// eslint-disable-next-line import/order
import { LambdaAwsClientService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-aws-client.service';
import { LambdaLayerManagerService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-layer-manager.service';
import { type LambdaDriverOptions } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/types/lambda-driver.type';
import { getLambdaDepsLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-deps-layer-name.util';
import { getLambdaSdkLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-sdk-layer-name.util';
import {
  callsNamed,
  createFakeLambdaClient,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/fake-lambda-client';
import {
  buildFakeLogicFunctionResourceService,
  buildFakeSdkClientArchiveService,
  buildFakeWorkspaceCacheService,
  buildFlatApplication,
  LAYER_BUCKET,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/lambda-test-fixtures';

const NAME_PREFIX = 'aos-crm-prod-lf-';
const RESOURCE_NAMESPACE = 'test-namespace';

// ensureSdkLayer rebuilds through reprefixLambdaZipEntries, which dynamic-
// imports archiver/unzipper at call time. jest.config.mjs enables fake
// timers globally, and those two libraries cache a setImmediate reference
// on first require; real timers must already be active before that first
// call, or their stream pipelines hang forever.
beforeAll(() => {
  jest.useRealTimers();
});

const buildHarness = ({ namePrefix }: { namePrefix?: string }) => {
  const fakeLambda = createFakeLambdaClient();

  mockLambdaSend.mockImplementation(fakeLambda.client.send);
  mockGetSignedUrl.mockResolvedValue('https://example-presigned-url.invalid');

  const flatApplication = buildFlatApplication();
  const awsClient = new LambdaAwsClientService({
    region: 'eu-west-1',
    layerBucket: LAYER_BUCKET,
    layerBucketRegion: 'eu-west-1',
    cacheStorageService: {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    },
  } as unknown as LambdaDriverOptions);

  const toolFunctions = {
    runYarnInstallCreateLayer: jest.fn().mockResolvedValue({ success: true }),
  } as unknown as LambdaToolFunctionsService;

  const layerManager = new LambdaLayerManagerService(
    {
      layerBucket: LAYER_BUCKET,
      resourceNamespace: RESOURCE_NAMESPACE,
      namePrefix,
    },
    awsClient,
    toolFunctions,
    buildFakeLogicFunctionResourceService() as any,
    buildFakeSdkClientArchiveService() as any,
    { withLock: jest.fn((fn: () => Promise<unknown>) => fn()) } as any,
    buildFakeWorkspaceCacheService(flatApplication) as any,
  );

  return { layerManager, toolFunctions, fakeLambda, flatApplication };
};

describe('LambdaLayerManagerService', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
    mockGetSignedUrl = jest.fn();
  });

  it('publishes a new deps layer from S3 with the prefixed LayerName when none exists yet', async () => {
    const { layerManager, fakeLambda, flatApplication } = buildHarness({
      namePrefix: NAME_PREFIX,
    });
    const expectedLayerName = getLambdaDepsLayerName({
      flatApplication,
      namespace: RESOURCE_NAMESPACE,
      namePrefix: NAME_PREFIX,
    });

    const arn = await layerManager.ensureDepsLayer({
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const publishes = callsNamed(
      fakeLambda.calls,
      'PublishLayerVersionCommand',
    );

    expect(publishes).toHaveLength(1);
    expect(publishes[0].input.LayerName).toBe(expectedLayerName);
    expect(expectedLayerName.startsWith(NAME_PREFIX)).toBe(true);
    expect(publishes[0].input.Content).toMatchObject({
      S3Bucket: LAYER_BUCKET,
    });
    expect(arn).toContain(expectedLayerName);
  });

  it('publishes a new deps layer with the bare namespaced LayerName when no prefix is set', async () => {
    const { layerManager, fakeLambda, flatApplication } = buildHarness({
      namePrefix: undefined,
    });
    const expectedLayerName = getLambdaDepsLayerName({
      flatApplication,
      namespace: RESOURCE_NAMESPACE,
      namePrefix: undefined,
    });

    await layerManager.ensureDepsLayer({
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const publishes = callsNamed(
      fakeLambda.calls,
      'PublishLayerVersionCommand',
    );

    expect(publishes[0].input.LayerName).toBe(expectedLayerName);
    expect(expectedLayerName.startsWith(NAME_PREFIX)).toBe(false);
  });

  it('rebuilds the SDK layer in memory with the prefixed LayerName', async () => {
    const { layerManager, fakeLambda, flatApplication } = buildHarness({
      namePrefix: NAME_PREFIX,
    });
    const expectedLayerName = getLambdaSdkLayerName({
      workspaceId: flatApplication.workspaceId,
      applicationUniversalIdentifier: 'app-universal-id',
      namePrefix: NAME_PREFIX,
    });

    const arn = await layerManager.ensureSdkLayer({
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const publishes = callsNamed(
      fakeLambda.calls,
      'PublishLayerVersionCommand',
    );

    expect(publishes).toHaveLength(1);
    expect(publishes[0].input.LayerName).toBe(expectedLayerName);
    expect(publishes[0].input.Content).toHaveProperty('ZipFile');
    expect(arn).toContain(expectedLayerName);
  });

  it('deletes every version of the prefixed SDK layer via ListLayerVersions + DeleteLayerVersion', async () => {
    const { layerManager, fakeLambda, flatApplication } = buildHarness({
      namePrefix: NAME_PREFIX,
    });
    const expectedLayerName = getLambdaSdkLayerName({
      workspaceId: flatApplication.workspaceId,
      applicationUniversalIdentifier: 'app-universal-id',
      namePrefix: NAME_PREFIX,
    });

    // Publish one version first so there is something real to delete.
    await layerManager.ensureSdkLayer({
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    await layerManager.deleteSdkLayer({
      workspaceId: flatApplication.workspaceId,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const lists = callsNamed(
      fakeLambda.calls,
      'ListLayerVersionsCommand',
    ).filter((call) => call.input.LayerName === expectedLayerName);
    const deletes = callsNamed(fakeLambda.calls, 'DeleteLayerVersionCommand');

    expect(lists.length).toBeGreaterThan(0);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.LayerName).toBe(expectedLayerName);
    expect(deletes[0].input.VersionNumber).toBe(1);
  });
});
