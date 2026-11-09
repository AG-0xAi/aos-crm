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
  };
});

// The real copyCommonLayerDependencies shells out to `yarn workspaces focus`
// to vendor the common layer's dependencies (archiver etc.) -- a real,
// possibly network-touching subprocess with no place in a unit test. Only
// ensureCommonLayerExists's zip-and-publish behavior is under test here, not
// dependency installation, so this becomes a no-op: createZipFile then just
// zips an empty directory, which is all a PublishLayerVersionCommand needs.
jest.mock(
  'src/engine/core-modules/logic-function/logic-function-drivers/utils/copy-common-layer-dependencies',
  () => ({
    copyCommonLayerDependencies: jest.fn().mockResolvedValue(undefined),
  }),
);

import { type LambdaToolFunctionsService as LambdaToolFunctionsServiceType } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-tool-functions.service';
// eslint-disable-next-line import/order
import { LambdaAwsClientService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-aws-client.service';
import { type LambdaDriverOptions } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/types/lambda-driver.type';
import { computeHashedLambdaResourceName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/compute-hashed-lambda-resource-name.util';
import {
  callsNamed,
  createFakeLambdaClient,
  fakeLambdaPayload,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/fake-lambda-client';
import { LAMBDA_ROLE_ARN } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/lambda-test-fixtures';

const NAME_PREFIX = 'aos-crm-prod-lf-';

const invokeCommandOverride = (input: any) => {
  const payload = JSON.parse(input.Payload);

  if (payload.action === 'transpile') {
    return { Payload: fakeLambdaPayload({ builtCode: 'compiled-output' }) };
  }

  if (payload.action === 'createLayer') {
    return { Payload: fakeLambdaPayload({ success: true }) };
  }

  return { Payload: fakeLambdaPayload({}) };
};

// jest.config.mjs enables fake timers globally; this service eagerly
// imports create-zip-file.ts (archiver), which caches a setImmediate
// reference on its first require. Importing the service dynamically, after
// `jest.useRealTimers()`, keeps that first require under real timers so the
// archiver stream pipeline it uses does not hang.
let LambdaToolFunctionsService: typeof LambdaToolFunctionsServiceType;

beforeAll(async () => {
  jest.useRealTimers();
  ({ LambdaToolFunctionsService } =
    await import('src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-tool-functions.service'));
});

const buildHarness = ({
  namePrefix,
  yarnInstallMemoryMb,
}: {
  namePrefix?: string;
  yarnInstallMemoryMb?: number;
}) => {
  const fakeLambda = createFakeLambdaClient({
    InvokeCommand: invokeCommandOverride,
  });

  mockLambdaSend.mockImplementation(fakeLambda.client.send);

  const awsClient = new LambdaAwsClientService({
    region: 'eu-west-1',
    cacheStorageService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  } as unknown as LambdaDriverOptions);

  const service = new LambdaToolFunctionsService(
    {
      lambdaRole: LAMBDA_ROLE_ARN,
      resourceNamespace: 'test-ns',
      namePrefix,
      yarnInstallMemoryMb,
    },
    awsClient,
  );

  return { service, fakeLambda };
};

describe('LambdaToolFunctionsService', () => {
  beforeEach(() => {
    mockLambdaSend = jest.fn();
  });

  it('publishes the common layer with a prefixed LayerName when a prefix is set', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });

    const arn = await service.ensureCommonLayerExists();

    const publishes = callsNamed(
      fakeLambda.calls,
      'PublishLayerVersionCommand',
    );

    expect(publishes).toHaveLength(1);
    expect(publishes[0].input.LayerName.startsWith(NAME_PREFIX)).toBe(true);
    expect(arn).toContain(publishes[0].input.LayerName);
  });

  it('publishes the common layer with an unprefixed LayerName when no prefix is set', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: undefined });

    await service.ensureCommonLayerExists();

    const publishes = callsNamed(
      fakeLambda.calls,
      'PublishLayerVersionCommand',
    );

    expect(publishes[0].input.LayerName.startsWith(NAME_PREFIX)).toBe(false);
  });

  it('creates the yarn-install tool Lambda with a prefixed FunctionName, then invokes it by that same name', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });

    const result = await service.runYarnInstallCreateLayer({
      packageJson: '{}',
      yarnLock: '',
      presignedUploadUrl: 'https://example.invalid/upload',
    });

    expect(result).toEqual({ success: true });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');
    const invokes = callsNamed(fakeLambda.calls, 'InvokeCommand');

    expect(creates).toHaveLength(1);
    expect(creates[0].input.FunctionName.startsWith(NAME_PREFIX)).toBe(true);
    expect(creates[0].input.Role).toBe(LAMBDA_ROLE_ARN);

    expect(invokes).toHaveLength(1);
    expect(invokes[0].input.FunctionName).toBe(creates[0].input.FunctionName);
  });

  it('creates the yarn-install tool Lambda with the configured memory', async () => {
    const { service, fakeLambda } = buildHarness({
      namePrefix: NAME_PREFIX,
      yarnInstallMemoryMb: 3008,
    });

    await service.runYarnInstallCreateLayer({
      packageJson: '{}',
      yarnLock: '',
      presignedUploadUrl: 'https://example.invalid/upload',
    });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');

    expect(creates[0].input.MemorySize).toBe(3008);
  });

  it('creates the yarn-install tool Lambda with an unprefixed FunctionName when no prefix is set', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: undefined });

    await service.runYarnInstallCreateLayer({
      packageJson: '{}',
      yarnLock: '',
      presignedUploadUrl: 'https://example.invalid/upload',
    });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');

    expect(creates[0].input.FunctionName.startsWith(NAME_PREFIX)).toBe(false);
  });

  it('creates the builder tool Lambda with a prefixed FunctionName, then invokes it to transpile', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });

    const result = await service.transpile({
      sourceCode: 'export const main = () => {};',
      sourceFileName: 'src/index.ts',
      builtFileName: 'src/index.mjs',
    });

    expect(result).toEqual({ builtCode: 'compiled-output' });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');
    const invokes = callsNamed(fakeLambda.calls, 'InvokeCommand');

    expect(creates).toHaveLength(1);
    expect(creates[0].input.FunctionName.startsWith(NAME_PREFIX)).toBe(true);
    expect(invokes[0].input.FunctionName).toBe(creates[0].input.FunctionName);
  });

  it('skips re-creating tool Lambdas that already exist', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });

    await service.transpile({
      sourceCode: 'export const main = () => {};',
      sourceFileName: 'src/index.ts',
      builtFileName: 'src/index.mjs',
    });
    await service.transpile({
      sourceCode: 'export const main = () => {};',
      sourceFileName: 'src/index.ts',
      builtFileName: 'src/index.mjs',
    });

    expect(callsNamed(fakeLambda.calls, 'CreateFunctionCommand')).toHaveLength(
      1,
    );
    expect(callsNamed(fakeLambda.calls, 'InvokeCommand')).toHaveLength(2);
  });

  it('computes the builder FunctionName the same way the service does, confirming the name is not improvised', async () => {
    const { service, fakeLambda } = buildHarness({ namePrefix: NAME_PREFIX });

    await service.transpile({
      sourceCode: 'export const main = () => {};',
      sourceFileName: 'src/index.ts',
      builtFileName: 'src/index.mjs',
    });

    const fs = await import('fs/promises');
    const {
      BUILDER_FUNCTION_NAME_PREFIX,
      BUILDER_HANDLER_PATH,
      BUILDER_LAMBDA_MEMORY_MB,
      BUILDER_LAMBDA_TIMEOUT_SECONDS,
      LAMBDA_EPHEMERAL_STORAGE_MB,
    } =
      await import('src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/constants/lambda-driver.constant');
    const handlerContent = await fs.readFile(BUILDER_HANDLER_PATH, 'utf-8');

    const expectedName = computeHashedLambdaResourceName({
      namePrefix: NAME_PREFIX,
      resourceNamePrefix: BUILDER_FUNCTION_NAME_PREFIX,
      namespace: 'test-ns',
      contents: [
        handlerContent,
        String(BUILDER_LAMBDA_MEMORY_MB),
        String(BUILDER_LAMBDA_TIMEOUT_SECONDS),
        String(LAMBDA_EPHEMERAL_STORAGE_MB),
      ],
    });

    const creates = callsNamed(fakeLambda.calls, 'CreateFunctionCommand');

    expect(creates[0].input.FunctionName).toBe(expectedName);
  });
});
