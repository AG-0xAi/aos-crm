let mockLambdaSend: jest.Mock;
let mockMiddlewareStackAdd: jest.Mock;

jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');

  return {
    ...actual,
    Lambda: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockLambdaSend(...args),
      middlewareStack: { add: (...args: unknown[]) => mockMiddlewareStackAdd(...args) },
    })),
  };
});

// eslint-disable-next-line import/order
import { ResourceNotFoundException } from '@aws-sdk/client-lambda';

import { LambdaAwsClientService } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/services/lambda-aws-client.service';
import { type LambdaDriverOptions } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/types/lambda-driver.type';
import {
  buildFakeCacheStorageService,
  LAYER_BUCKET,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/__tests__/support/lambda-test-fixtures';

describe('LambdaAwsClientService', () => {
  let cacheStorageService: ReturnType<typeof buildFakeCacheStorageService>;
  let service: LambdaAwsClientService;

  beforeEach(() => {
    mockLambdaSend = jest.fn();
    mockMiddlewareStackAdd = jest.fn();
    cacheStorageService = buildFakeCacheStorageService();

    service = new LambdaAwsClientService({
      region: 'eu-west-1',
      layerBucket: LAYER_BUCKET,
      layerBucketRegion: 'eu-west-1',
      cacheStorageService,
    } as unknown as LambdaDriverOptions);
  });

  it('forwards the resolved FunctionName unchanged to GetFunctionCommand, prefixed or not', async () => {
    mockLambdaSend.mockResolvedValue({ Configuration: { State: 'Pending' } });

    await service.getFunction('aos-crm-prod-lf-fn-id');
    await service.getFunction('fn-id');

    expect(mockLambdaSend).toHaveBeenCalledTimes(2);
    expect(mockLambdaSend.mock.calls[0][0].input).toEqual({
      FunctionName: 'aos-crm-prod-lf-fn-id',
    });
    expect(mockLambdaSend.mock.calls[1][0].input).toEqual({
      FunctionName: 'fn-id',
    });
  });

  it('returns undefined instead of throwing when the function does not exist', async () => {
    mockLambdaSend.mockRejectedValue(
      new ResourceNotFoundException({ message: 'nope', $metadata: {} }),
    );

    await expect(service.getFunction('fn-id')).resolves.toBeUndefined();
  });

  it('forwards the resolved LayerName unchanged to ListLayerVersionsCommand, prefixed or not', async () => {
    mockLambdaSend.mockResolvedValue({
      LayerVersions: [{ LayerVersionArn: 'arn:aws:lambda:...:layer:x:1' }],
    });

    await service.getExistingLayerArn('aos-crm-prod-lf-deps-abc');
    await service.getExistingLayerArn('deps-abc');

    expect(mockLambdaSend.mock.calls[0][0].input).toEqual({
      LayerName: 'aos-crm-prod-lf-deps-abc',
      MaxItems: 1,
    });
    expect(mockLambdaSend.mock.calls[1][0].input).toEqual({
      LayerName: 'deps-abc',
      MaxItems: 1,
    });
  });
});
