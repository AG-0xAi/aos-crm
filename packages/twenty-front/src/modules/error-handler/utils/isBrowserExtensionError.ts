const BROWSER_EXTENSION_SCHEMES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
];

const containsBrowserExtensionScheme = (value: unknown): boolean =>
  typeof value === 'string' &&
  BROWSER_EXTENSION_SCHEMES.some((scheme) => value.includes(scheme));

export const isBrowserExtensionError = (reason: unknown): boolean => {
  if (containsBrowserExtensionScheme(reason)) {
    return true;
  }

  if (typeof reason !== 'object' || reason === null) {
    return false;
  }

  const { stack, filename, source } = reason as {
    stack?: unknown;
    filename?: unknown;
    source?: unknown;
  };

  return (
    containsBrowserExtensionScheme(stack) ||
    containsBrowserExtensionScheme(filename) ||
    containsBrowserExtensionScheme(source)
  );
};
