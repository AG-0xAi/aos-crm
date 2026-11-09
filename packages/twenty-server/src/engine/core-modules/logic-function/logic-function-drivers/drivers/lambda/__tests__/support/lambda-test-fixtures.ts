import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import {
  LogicFunctionExecutionMode,
  LogicFunctionRuntime,
} from 'src/engine/metadata-modules/logic-function/logic-function.entity';
import { type FlatLogicFunction } from 'src/engine/metadata-modules/logic-function/types/flat-logic-function.type';

export const LAMBDA_ROLE_ARN =
  'arn:aws:iam::123456789012:role/aos-crm-staging-logic-function-exec';
export const LAYER_BUCKET = 'aos-crm-staging-logic-function-layers';

// A minimal, valid, empty zip (just the End Of Central Directory record):
// enough for `unzipper.Open.buffer` to parse without a real archive.
export const EMPTY_ZIP_BUFFER = Buffer.from(
  '504b0506000000000000000000000000000000000000',
  'hex',
);

export const buildFlatLogicFunction = (
  overrides: Partial<FlatLogicFunction> = {},
): FlatLogicFunction =>
  ({
    id: 'a1a1a1a1-0000-4000-8000-000000000001',
    workspaceId: 'ws-1a1a1a1a-0000-4000-8000-000000000002',
    name: 'send-reminder',
    sourceHandlerPath: 'src/index.ts',
    builtHandlerPath: 'src/index.mjs',
    handlerName: 'main',
    description: null,
    runtime: LogicFunctionRuntime.NODE22,
    timeoutSeconds: 300,
    checksum: 'checksum-v1',
    isBuildUpToDate: true,
    executionMode: LogicFunctionExecutionMode.LIVE,
    ...overrides,
  }) as unknown as FlatLogicFunction;

export const buildFlatApplication = (
  overrides: Partial<FlatApplication> = {},
): FlatApplication =>
  ({
    id: 'app-1a1a1a1a-0000-4000-8000-000000000003',
    workspaceId: 'ws-1a1a1a1a-0000-4000-8000-000000000002',
    universalIdentifier: 'app-universal-id',
    yarnLockChecksum: 'yarn-lock-checksum',
    isSdkLayerStale: false,
    sdkClientCoreChecksum: 'sdk-client-checksum',
    ...overrides,
  }) as unknown as FlatApplication;

export const buildFakeCacheLockService = () => ({
  delay: jest.fn().mockResolvedValue(undefined),
  withLock: jest.fn((fn: () => Promise<unknown>) => fn()),
});

export const buildFakeCacheStorageService = () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
});

export const buildFakeWorkspaceCacheService = (
  flatApplication: FlatApplication,
) => ({
  getOrRecompute: jest.fn().mockResolvedValue({
    flatApplicationMaps: { byId: { [flatApplication.id]: flatApplication } },
  }),
});

export const buildFakeLogicFunctionResourceService = () => ({
  getBuiltCode: jest
    .fn()
    .mockResolvedValue('export const main = async () => ({ ok: true });'),
  copyDependenciesInMemory: jest.fn(
    async ({ inMemoryFolderPath }: { inMemoryFolderPath: string }) => {
      const fs = await import('fs/promises');
      const path = await import('path');

      await fs.writeFile(
        path.join(inMemoryFolderPath, 'package.json'),
        '{"name":"deps","version":"1.0.0"}',
        'utf-8',
      );
      await fs.writeFile(
        path.join(inMemoryFolderPath, 'yarn.lock'),
        '# yarn lockfile v1\n',
        'utf-8',
      );
    },
  ),
});

export const buildFakeSdkClientArchiveService = () => ({
  downloadArchiveBuffer: jest.fn().mockResolvedValue(EMPTY_ZIP_BUFFER),
  markSdkLayerFresh: jest.fn().mockResolvedValue(undefined),
});
