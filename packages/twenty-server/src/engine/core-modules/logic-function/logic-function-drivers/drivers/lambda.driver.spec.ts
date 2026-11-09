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

import { type LambdaDriver as LambdaDriverType } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda.driver';
// eslint-disable-next-line import/order
import { type LambdaDriverOptions } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/types/lambda-driver.type';
import { getLambdaDepsLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-deps-layer-name.util';
import { getLambdaSdkLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-sdk-layer-name.util';
import {
  callsNamed,
  createFakeLambdaClient,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/fake-lambda-client';
import {
  buildFakeCacheLockService,
  buildFakeCacheStorageService,
  buildFakeLogicFunctionResourceService,
  buildFakeSdkClientArchiveService,
  buildFakeWorkspaceCacheService,
  buildFlatApplication,
  buildFlatLogicFunction,
  LAMBDA_ROLE_ARN,
  LAYER_BUCKET,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/lambda-test-fixtures';
import { LogicFunctionExecutionStatus } from 'src/engine/metadata-modules/logic-function/dtos/logic-function-execution-result.dto';

const NAME_PREFIX = 'aos-crm-prod-lf-';
const RESOURCE_NAMESPACE = 'test-ns';
const APPLICATION_UNIVERSAL_IDENTIFIER = 'app-universal-id';

// jest.config.mjs enables fake timers globally; LambdaDriver statically
// pulls in LambdaExecutorManagerService/LambdaToolFunctionsService, which
// eagerly import create-zip-file.ts (archiver). archiver caches a
// setImmediate reference on its first require, so that first require must
// happen under real timers or its stream pipeline hangs the moment any test
// exercises it.
let LambdaDriver: typeof LambdaDriverType;

beforeAll(async () => {
  jest.useRealTimers();
  ({ LambdaDriver } = await import(
    'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda.driver'
  ));
});

const buildOptions = (
  namePrefix: string | undefined,
  flatApplication: ReturnType<typeof buildFlatApplication>,
): LambdaDriverOptions =>
  ({
    region: 'eu-west-1',
    lambdaRole: LAMBDA_ROLE_ARN,
    layerBucket: LAYER_BUCKET,
    layerBucketRegion: 'eu-west-1',
    resourceNamespace: RESOURCE_NAMESPACE,
    namePrefix,
    logicFunctionResourceService: buildFakeLogicFunctionResourceService(),
    sdkClientArchiveService: buildFakeSdkClientArchiveService(),
    cacheLockService: buildFakeCacheLockService(),
    cacheStorageService: buildFakeCacheStorageService(),
    workspaceCacheService: buildFakeWorkspaceCacheService(flatApplication),
  }) as unknown as LambdaDriverOptions;

describe('LambdaDriver constructor', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
  });

  it('accepts a namePrefix that fits AWS Lambda name limits', () => {
    const flatApplication = buildFlatApplication();

    expect(
      () => new LambdaDriver(buildOptions(NAME_PREFIX, flatApplication)),
    ).not.toThrow();
  });

  it('refuses a namePrefix too long to keep prefixed names under the 64-char Lambda limit', () => {
    const flatApplication = buildFlatApplication();
    const tooLongPrefix = 'a'.repeat(40);

    expect(
      () => new LambdaDriver(buildOptions(tooLongPrefix, flatApplication)),
    ).toThrow(/LOGIC_FUNCTION_LAMBDA_NAME_PREFIX/);
  });
});

describe('LambdaDriver.execute', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
  });

  // Seeds the fake Lambda control plane with an already-up-to-date executor
  // (Active, current layers, current SDK checksum) so buildExecutor's
  // checkBuildStatus short-circuits with canSkip=true. This isolates
  // execute()'s own InvokeCommand from the full (and separately tested, in
  // lambda-executor-manager/lambda-layer-manager/lambda-tool-functions'
  // specs) provisioning chain a cold build would otherwise trigger.
  const seedUpToDateExecutor = ({
    fakeLambda,
    flatLogicFunction,
    flatApplication,
    namePrefix,
    expectedFunctionName,
  }: {
    fakeLambda: ReturnType<typeof createFakeLambdaClient>;
    flatLogicFunction: ReturnType<typeof buildFlatLogicFunction>;
    flatApplication: ReturnType<typeof buildFlatApplication>;
    namePrefix: string | undefined;
    expectedFunctionName: string;
  }) => {
    const depsLayerName = getLambdaDepsLayerName({
      flatApplication,
      namespace: RESOURCE_NAMESPACE,
      namePrefix,
    });
    const sdkLayerName = getLambdaSdkLayerName({
      workspaceId: flatApplication.workspaceId,
      applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
      namePrefix,
    });

    fakeLambda.functions.set(expectedFunctionName, {
      Configuration: {
        FunctionName: expectedFunctionName,
        State: 'Active',
        FunctionArn: `arn:aws:lambda:eu-west-1:123456789012:function:${expectedFunctionName}`,
        Layers: [
          { Arn: `arn:aws:lambda:eu-west-1:123456789012:layer:${depsLayerName}:1` },
          { Arn: `arn:aws:lambda:eu-west-1:123456789012:layer:${sdkLayerName}:1` },
        ],
      },
      Tags: {},
    });
  };

  it('invokes the executor using the prefixed FunctionName when a prefix is set', async () => {
    const fakeLambda = createFakeLambdaClient();

    mockLambdaSend.mockImplementation(fakeLambda.client.send);

    const flatApplication = buildFlatApplication({
      sdkClientCoreChecksum: null,
    });
    const flatLogicFunction = buildFlatLogicFunction();
    const expectedFunctionName = `${NAME_PREFIX}${flatLogicFunction.id}`;

    seedUpToDateExecutor({
      fakeLambda,
      flatLogicFunction,
      flatApplication,
      namePrefix: NAME_PREFIX,
      expectedFunctionName,
    });

    const driver = new LambdaDriver(buildOptions(NAME_PREFIX, flatApplication));

    const result = await driver.execute({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
      payload: { hello: 'world' },
      context: {} as any,
      env: {},
    });

    expect(result.status).toBe(LogicFunctionExecutionStatus.SUCCESS);

    const invokes = callsNamed(fakeLambda.calls, 'InvokeCommand');

    expect(invokes).toHaveLength(1);
    expect(invokes[0].input.FunctionName).toBe(expectedFunctionName);
    expect(callsNamed(fakeLambda.calls, 'CreateFunctionCommand')).toHaveLength(
      0,
    );
  });

  it('invokes the executor using the bare id when no prefix is set', async () => {
    const fakeLambda = createFakeLambdaClient();

    mockLambdaSend.mockImplementation(fakeLambda.client.send);

    const flatApplication = buildFlatApplication({
      sdkClientCoreChecksum: null,
    });
    const flatLogicFunction = buildFlatLogicFunction();

    seedUpToDateExecutor({
      fakeLambda,
      flatLogicFunction,
      flatApplication,
      namePrefix: undefined,
      expectedFunctionName: flatLogicFunction.id,
    });

    const driver = new LambdaDriver(buildOptions(undefined, flatApplication));

    await driver.execute({
      flatLogicFunction,
      flatApplication,
      applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
      payload: { hello: 'world' },
      context: {} as any,
      env: {},
    });

    const invokes = callsNamed(fakeLambda.calls, 'InvokeCommand');

    expect(invokes[0].input.FunctionName).toBe(flatLogicFunction.id);
    expect(invokes[0].input.FunctionName.startsWith(NAME_PREFIX)).toBe(false);
  });
});

describe('LambdaDriver.delete', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
  });

  it('deletes the executor using the prefixed FunctionName', async () => {
    const fakeLambda = createFakeLambdaClient();

    mockLambdaSend.mockImplementation(fakeLambda.client.send);

    const flatApplication = buildFlatApplication();
    const flatLogicFunction = buildFlatLogicFunction();
    const driver = new LambdaDriver(buildOptions(NAME_PREFIX, flatApplication));

    await driver.delete(flatLogicFunction);

    const deletes = callsNamed(fakeLambda.calls, 'DeleteFunctionCommand');

    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.FunctionName).toBe(
      `${NAME_PREFIX}${flatLogicFunction.id}`,
    );
  });
});
