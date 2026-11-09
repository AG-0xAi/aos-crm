import { getLambdaSdkLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-sdk-layer-name.util';

describe('getLambdaSdkLayerName', () => {
  it('joins workspaceId and applicationUniversalIdentifier with the sdk- prefix', () => {
    expect(
      getLambdaSdkLayerName({
        workspaceId: 'workspace-1',
        applicationUniversalIdentifier: 'app-1',
      }),
    ).toBe('sdk-workspace-1-app-1');
  });

  it('prepends the namePrefix when it is set', () => {
    expect(
      getLambdaSdkLayerName({
        workspaceId: 'workspace-1',
        applicationUniversalIdentifier: 'app-1',
        namePrefix: 'aos-crm-prod-lf-',
      }),
    ).toBe('aos-crm-prod-lf-sdk-workspace-1-app-1');
  });
});
