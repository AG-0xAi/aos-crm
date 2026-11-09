import { applyLambdaNamePrefix } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/apply-lambda-name-prefix.util';
import { type FlatLogicFunction } from 'src/engine/metadata-modules/logic-function/types/flat-logic-function.type';

export const getLambdaExecutorFunctionName = ({
  flatLogicFunction,
  namePrefix,
}: {
  flatLogicFunction: Pick<FlatLogicFunction, 'id'>;
  namePrefix?: string;
}): string => applyLambdaNamePrefix({ namePrefix, name: flatLogicFunction.id });
