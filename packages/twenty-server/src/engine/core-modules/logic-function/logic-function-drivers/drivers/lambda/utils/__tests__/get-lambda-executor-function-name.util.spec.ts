import { getLambdaExecutorFunctionName } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-executor-function-name.util';

describe('getLambdaExecutorFunctionName', () => {
  it('returns the logic function id unchanged when no namePrefix is set', () => {
    expect(
      getLambdaExecutorFunctionName({
        flatLogicFunction: { id: 'logic-function-1' },
      }),
    ).toBe('logic-function-1');
  });

  it('prepends the namePrefix when it is set', () => {
    expect(
      getLambdaExecutorFunctionName({
        flatLogicFunction: { id: 'logic-function-1' },
        namePrefix: 'aos-crm-prod-lf-',
      }),
    ).toBe('aos-crm-prod-lf-logic-function-1');
  });
});
