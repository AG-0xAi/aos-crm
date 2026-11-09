import { isNonEmptyString } from '@sniptt/guards';

import { applyLambdaNamePrefix } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/apply-lambda-name-prefix.util';

export const buildLambdaResourceName = ({
  namePrefix,
  resourceNamePrefix,
  namespace,
  checksum,
}: {
  namePrefix?: string;
  resourceNamePrefix: string;
  namespace?: string;
  checksum: string;
}): string =>
  applyLambdaNamePrefix({
    namePrefix,
    name: isNonEmptyString(namespace)
      ? `${resourceNamePrefix}-${namespace}-${checksum}`
      : `${resourceNamePrefix}-${checksum}`,
  });
