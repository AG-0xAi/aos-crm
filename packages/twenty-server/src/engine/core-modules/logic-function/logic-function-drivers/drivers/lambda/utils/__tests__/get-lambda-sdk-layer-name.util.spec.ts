import { getLambdaSdkLayerName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-sdk-layer-name.util';

describe('getLambdaSdkLayerName', () => {
  it('joins prefix with workspaceId and applicationUniversalIdentifier', () => {
    expect(
      getLambdaSdkLayerName({
        workspaceId: 'ws-1',
        applicationUniversalIdentifier: 'app-2',
      }),
    ).toBe('sdk-ws-1-app-2');
  });

  it('produces distinct names for distinct identifiers', () => {
    const a = getLambdaSdkLayerName({
      workspaceId: 'a',
      applicationUniversalIdentifier: 'x',
    });
    const b = getLambdaSdkLayerName({
      workspaceId: 'b',
      applicationUniversalIdentifier: 'x',
    });

    expect(a).not.toBe(b);
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

  it('does not prepend anything when namePrefix is empty', () => {
    expect(
      getLambdaSdkLayerName({
        workspaceId: 'workspace-1',
        applicationUniversalIdentifier: 'app-1',
        namePrefix: '',
      }),
    ).toBe('sdk-workspace-1-app-1');
  });
});
