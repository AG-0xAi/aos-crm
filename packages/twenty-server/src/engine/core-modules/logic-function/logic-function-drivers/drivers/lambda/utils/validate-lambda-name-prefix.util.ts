import { isNonEmptyString } from '@sniptt/guards';

import {
  BUILDER_FUNCTION_NAME_PREFIX,
  YARN_INSTALL_FUNCTION_NAME_PREFIX,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/constants/lambda-driver.constant';
import { RESOURCE_NAME_CHECKSUM_LENGTH } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/compute-hashed-lambda-resource-name.util';
import { RESOURCE_NAMESPACE_LENGTH } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-resource-namespace.util';

// AWS Lambda function names (not layer names, whose 140-char limit is never
// the binding constraint here) are capped at 64 characters.
const LAMBDA_FUNCTION_NAME_MAX_LENGTH = 64;

// Logic function ids, workspace ids and application ids are all UUIDs.
const UUID_LENGTH = 36;

const LONGEST_FIXED_TOOL_FUNCTION_NAME_PREFIX_LENGTH = Math.max(
  BUILDER_FUNCTION_NAME_PREFIX.length,
  YARN_INSTALL_FUNCTION_NAME_PREFIX.length,
);

// "<prefix>-<namespace>-<checksum>", the longest unprefixed function name the
// driver builds (the builder/yarn-install tool functions).
const WORST_CASE_TOOL_FUNCTION_NAME_LENGTH =
  LONGEST_FIXED_TOOL_FUNCTION_NAME_PREFIX_LENGTH +
  1 +
  RESOURCE_NAMESPACE_LENGTH +
  1 +
  RESOURCE_NAME_CHECKSUM_LENGTH;

export const getMaxLambdaNamePrefixLength = (): number =>
  LAMBDA_FUNCTION_NAME_MAX_LENGTH -
  Math.max(WORST_CASE_TOOL_FUNCTION_NAME_LENGTH, UUID_LENGTH);

export const assertLambdaNamePrefixFitsNameLimits = (
  namePrefix: string | undefined,
): void => {
  if (!isNonEmptyString(namePrefix)) {
    return;
  }

  const maxLength = getMaxLambdaNamePrefixLength();

  if (namePrefix.length > maxLength) {
    throw new Error(
      `LOGIC_FUNCTION_LAMBDA_NAME_PREFIX "${namePrefix}" is ${namePrefix.length} characters long, but must be at most ${maxLength} so prefixed Lambda function names stay within AWS's ${LAMBDA_FUNCTION_NAME_MAX_LENGTH}-character limit.`,
    );
  }
};
