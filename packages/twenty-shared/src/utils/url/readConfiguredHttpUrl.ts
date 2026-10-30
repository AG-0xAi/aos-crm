// Config variables arrive as strings from an environment file, where "unset"
// is usually an empty placeholder rather than a missing key. Anything that is
// not an absolute http(s) URL is treated as unset, so a typo hides the link
// instead of rendering one that goes nowhere.
export const readConfiguredHttpUrl = (
  value: string | null | undefined,
): string | undefined => {
  const trimmed = (value ?? '').trim();

  if (trimmed === '') {
    return undefined;
  }

  try {
    const { protocol } = new URL(trimmed);

    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
};
