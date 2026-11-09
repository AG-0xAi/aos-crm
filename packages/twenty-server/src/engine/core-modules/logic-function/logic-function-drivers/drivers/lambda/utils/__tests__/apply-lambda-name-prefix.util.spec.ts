import { applyLambdaNamePrefix } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/apply-lambda-name-prefix.util';

describe('applyLambdaNamePrefix', () => {
  it('prepends the prefix when it is set', () => {
    expect(
      applyLambdaNamePrefix({ namePrefix: 'aos-crm-prod-lf-', name: 'abc123' }),
    ).toBe('aos-crm-prod-lf-abc123');
  });

  it('returns the name unchanged when the prefix is undefined', () => {
    expect(applyLambdaNamePrefix({ name: 'abc123' })).toBe('abc123');
  });

  it('returns the name unchanged when the prefix is an empty string', () => {
    expect(applyLambdaNamePrefix({ namePrefix: '', name: 'abc123' })).toBe(
      'abc123',
    );
  });
});
