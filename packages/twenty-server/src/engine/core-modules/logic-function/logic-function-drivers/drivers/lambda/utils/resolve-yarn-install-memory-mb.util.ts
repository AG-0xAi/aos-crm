import { YARN_INSTALL_LAMBDA_MEMORY_MB } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/constants/lambda-driver.constant';

const LAMBDA_MIN_MEMORY_MB = 128;
const LAMBDA_MAX_MEMORY_MB = 10240;

export const resolveYarnInstallMemoryMb = (configured?: number): number => {
  if (configured === undefined || configured === null) {
    return YARN_INSTALL_LAMBDA_MEMORY_MB;
  }

  if (
    !Number.isInteger(configured) ||
    configured < LAMBDA_MIN_MEMORY_MB ||
    configured > LAMBDA_MAX_MEMORY_MB
  ) {
    throw new Error(
      `LOGIC_FUNCTION_LAMBDA_YARN_INSTALL_MEMORY_MB must be an integer between ${LAMBDA_MIN_MEMORY_MB} and ${LAMBDA_MAX_MEMORY_MB}, got ${configured}.`,
    );
  }

  return configured;
};
