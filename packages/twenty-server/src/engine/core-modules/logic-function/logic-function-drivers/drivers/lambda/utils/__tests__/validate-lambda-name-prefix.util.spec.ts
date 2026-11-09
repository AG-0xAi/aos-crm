import {
  assertLambdaNamePrefixFitsNameLimits,
  getMaxLambdaNamePrefixLength,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/validate-lambda-name-prefix.util';

describe('assertLambdaNamePrefixFitsNameLimits', () => {
  it('does not throw when namePrefix is undefined', () => {
    expect(() => assertLambdaNamePrefixFitsNameLimits(undefined)).not.toThrow();
  });

  it('does not throw when namePrefix is an empty string', () => {
    expect(() => assertLambdaNamePrefixFitsNameLimits('')).not.toThrow();
  });

  it('does not throw when namePrefix is exactly at the max length', () => {
    const maxLength = getMaxLambdaNamePrefixLength();

    expect(() =>
      assertLambdaNamePrefixFitsNameLimits('a'.repeat(maxLength)),
    ).not.toThrow();
  });

  it('throws when namePrefix exceeds the max length', () => {
    const maxLength = getMaxLambdaNamePrefixLength();

    expect(() =>
      assertLambdaNamePrefixFitsNameLimits('a'.repeat(maxLength + 1)),
    ).toThrow(/LOGIC_FUNCTION_LAMBDA_NAME_PREFIX/);
  });
});
