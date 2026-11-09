import { applyLambdaNamePrefix } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/apply-lambda-name-prefix.util';

export const getLambdaSdkLayerName = ({
  workspaceId,
  applicationUniversalIdentifier,
  namePrefix,
}: {
  workspaceId: string;
  applicationUniversalIdentifier: string;
  namePrefix?: string;
}): string =>
  applyLambdaNamePrefix({
    namePrefix,
    name: `sdk-${workspaceId}-${applicationUniversalIdentifier}`,
  });
