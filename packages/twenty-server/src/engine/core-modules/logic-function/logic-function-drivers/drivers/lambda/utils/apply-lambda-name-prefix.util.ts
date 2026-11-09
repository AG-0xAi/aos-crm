import { isNonEmptyString } from '@sniptt/guards';

export const applyLambdaNamePrefix = ({
  namePrefix,
  name,
}: {
  namePrefix?: string;
  name: string;
}): string => (isNonEmptyString(namePrefix) ? `${namePrefix}${name}` : name);
