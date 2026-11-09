let mockLambdaSend: jest.Mock;

jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');

  return {
    ...actual,
    Lambda: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockLambdaSend(...args),
      middlewareStack: { add: jest.fn() },
    })),
    waitUntilFunctionActiveV2: jest.fn().mockResolvedValue({}),
    waitUntilFunctionUpdatedV2: jest.fn().mockResolvedValue({}),
  };
});

import { type LambdaLayerManagerService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-layer-manager.service';
// eslint-disable-next-line import/order
import { LambdaAwsClientService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-aws-client.service';
import { type LambdaExecutorManagerService as LambdaExecutorManagerServiceType } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-executor-manager.service';
import { type LambdaDriverOptions } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/types/lambda-driver.type';
import {
  callsNamed,
  createFakeLambdaClient,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/fake-lambda-client';
import {
  buildFakeCacheLockService,
  buildFakeCacheStorageService,
  buildFakeLogicFunctionResourceService,
  buildFakeWorkspaceCacheService,
  buildFlatApplication,
  buildFlatLogicFunction,
  LAMBDA_ROLE_ARN,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/lambda-test-fixtures';

const NAME_PREFIX = 'aos-crm-prod-lf-';

// `jest.config.mjs` enables fake timers globally, and archiver (pulled in
// transitively by this service, through create-zip-file.ts) caches a
// setImmediate reference the first time it is `require`d. If that first
// require happens at this file's static-import time (before real timers are
// switched on), the cached reference stays fake forever and createZipFile's
// stream pipeline hangs. Importing the service dynamically, after
// `jest.useRealTimers()`, makes that first require happen under real timers.
let LambdaExecutorManagerService: typeof LambdaExecutorManagerServiceType;

beforeAll(async () => {
  jest.useRealTimers();
  ({ LambdaExecutorManagerService } =
    await import('src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-executor-manager.service'));
});

const buildHarness = ({ namePrefix }: { namePrefix?: string }) => {
  const fakeLambda = createFakeLambdaClient();

  mockLambdaSend.mockImplementation(fakeLambda.client.send);

  const flatApplication = buildFlatApplication();
  const awsClient = new LambdaAwsClientService({
    region: 'eu-west-1',
    cacheStorageService: buildFakeCacheStorageService(),
  } as unknown as LambdaDriverOptions);

  const layerManager = {
    ensureDepsLayer: jest
      .fn()
      .mockResolvedValue('arn:aws:lambda:eu-west-1:123456789012:layer:deps:1'),
    ensureSdkLayer: jest
      .fn()
      .mockResolvedValue('arn:aws:lambda:eu-west-1:123456789012:layer:sdk:1'),
    deleteSdkLayer: jest.fn().mockResolvedValue(undefined),
    hasExpectedLayers: jest.fn().mockReturnValue(false),
  } as unknown as LambdaLayerManagerService;

  const service = new LambdaExecutorManagerService(
    { lambdaRole: LAMBDA_ROLE_ARN, namePrefix },
    awsClient,
    layerManager,
    buildFakeCacheLockService() as any,
    buildFakeLogicFunctionResourceService() as any,
    buildFakeWorkspaceCacheService(flatApplication) as any,
  );

  return { service, layerManager, fakeLambda, flatApplication };
};

describe('LambdaExecutorManagerService', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
  });

  it('deletes the executor using the prefixed FunctionName when a prefix is set', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });
    const flatLogicFunction = buildFlatLogicFunction();

    await service.delete(flatLogicFunction);

    const deletes = callsNamed(fakeLambda.calls, 'DeleteFunctionCommand');

    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.FunctionName).toBe(
      `${NAME_PREFIX}${flatLogicFunction.id}`,
    );
  });

  it('deletes the executor using the bare id when no prefix is set', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: undefined });
    const flatLogicFunction = buildFlatLogicFunction();

    await service.delete(flatLogicFunction);

    const deletes = callsNamed(fakeLambda.calls, 'DeleteFunctionCommand');

    expect(deletes[0].input.FunctionName).toBe(flatLogicFunction.id);
  });

  it('creates a new executor with the prefixed FunctionName when it does not exist yet, then updates it once layers go stale', async () => {
    const { service, layerManager, fakeLambda, flatApplication } = buildHarness(
      { namePrefix: NAME_PREFIX },
    );
    const flatLogicFunction = buildFlatLogicFunction();
    const expectedFunctionName = `${NAME_PREFIX}${flatLogicFunction.id}`;

    await service.buildExecutor({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');

    expect(creates).toHaveLength(1);
    expect(creates[0].input.FunctionName).toBe(expectedFunctionName);
    expect(creates[0].input.Role).toBe(LAMBDA_ROLE_ARN);
    expect(creates[0].input.Layers).toEqual([
      'arn:aws:lambda:eu-west-1:123456789012:layer:deps:1',
      'arn:aws:lambda:eu-west-1:123456789012:layer:sdk:1',
    ]);
    expect(
      callsNamed(fakeLambda.calls, 'UpdateFunctionConfigurationCommand'),
    ).toHaveLength(0);

    // Layers are now reported stale: the second build must update the
    // existing function in place, using the same prefixed FunctionName.
    layerManager.hasExpectedLayers = jest.fn().mockReturnValue(false);

    await service.buildExecutor({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const updates = callsNamed(
      fakeLambda.calls,
      'UpdateFunctionConfigurationCommand',
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].input.FunctionName).toBe(expectedFunctionName);

    const tags = callsNamed(fakeLambda.calls, 'TagResourceCommand');

    expect(tags).toHaveLength(1);
    expect(tags[0].input.Resource).toContain(expectedFunctionName);
  });

  it('creates a new executor with the bare id when no prefix is set', async () => {
    const { service, fakeLambda, flatApplication } = buildHarness({
      namePrefix: undefined,
    });
    const flatLogicFunction = buildFlatLogicFunction();

    await service.buildExecutor({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');

    expect(creates[0].input.FunctionName).toBe(flatLogicFunction.id);
  });

  it('installs a prebuilt bundle via UpdateFunctionCode and tags the checksum, using the prefixed FunctionName', async () => {
    const { service, fakeLambda, flatApplication } = buildHarness({
      namePrefix: NAME_PREFIX,
    });
    const flatLogicFunction = buildFlatLogicFunction({
      checksum: 'bundle-checksum-v1',
    });
    const expectedFunctionName = `${NAME_PREFIX}${flatLogicFunction.id}`;

    await service.installPrebuiltBundle({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: 'app-universal-id',
    });

    const updatesCode = callsNamed(
      fakeLambda.calls,
      'UpdateFunctionCodeCommand',
    );

    expect(updatesCode).toHaveLength(1);
    expect(updatesCode[0].input.FunctionName).toBe(expectedFunctionName);

    const tags = callsNamed(fakeLambda.calls, 'TagResourceCommand');
    const bundleTag = tags.find(
      (tag) =>
        tag.input.Tags?.['twenty:bundle-checksum'] === 'bundle-checksum-v1',
    );

    expect(bundleTag).toBeDefined();
    expect(bundleTag?.input.Resource).toContain(expectedFunctionName);
  });
});
