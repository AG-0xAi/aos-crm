import { YARN_INSTALL_LAMBDA_MEMORY_MB } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/constants/lambda-driver.constant';
import { resolveYarnInstallMemoryMb } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/resolve-yarn-install-memory-mb.util';

describe('resolveYarnInstallMemoryMb', () => {
  it('keeps the upstream default when nothing is configured', () => {
    expect(resolveYarnInstallMemoryMb(undefined)).toBe(
      YARN_INSTALL_LAMBDA_MEMORY_MB,
    );
  });

  it('uses the configured value, such as the 3008 MB cap of a new account', () => {
    expect(resolveYarnInstallMemoryMb(3008)).toBe(3008);
  });

  it('rejects values Lambda would refuse', () => {
    expect(() => resolveYarnInstallMemoryMb(64)).toThrow();
    expect(() => resolveYarnInstallMemoryMb(20000)).toThrow();
    expect(() => resolveYarnInstallMemoryMb(1024.5)).toThrow();
  });
});
