import { isBrowserExtensionError } from '@/error-handler/utils/isBrowserExtensionError';

describe('isBrowserExtensionError', () => {
  it('should return true for a chrome-extension:// stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n at chrome-extension://abcdefg/inject.js:1:1';

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return true for a moz-extension:// stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n at moz-extension://abcdefg/inject.js:1:1';

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return true for a safari-extension:// stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n at safari-extension://abcdefg/inject.js:1:1';

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return true for a safari-web-extension:// stack', () => {
    const error = new Error('boom');
    error.stack =
      'Error: boom\n at safari-web-extension://abcdefg/inject.js:1:1';

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return true when the filename carries an extension scheme', () => {
    const error = { message: 'boom', filename: 'chrome-extension://abc/x.js' };

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return true when the source carries an extension scheme', () => {
    const error = { message: 'boom', source: 'moz-extension://abc/x.js' };

    expect(isBrowserExtensionError(error)).toBe(true);
  });

  it('should return false for a normal app error stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n at https://app.example.com/main.js:1:1';

    expect(isBrowserExtensionError(error)).toBe(false);
  });

  it('should return false for a string reason without an extension scheme', () => {
    expect(isBrowserExtensionError('Failed to connect to MetaMask')).toBe(
      false,
    );
  });

  it('should return true for a string reason containing an extension scheme', () => {
    expect(isBrowserExtensionError('at chrome-extension://abc/inject.js')).toBe(
      true,
    );
  });

  it('should return false for an object reason without a stack, filename or source', () => {
    expect(isBrowserExtensionError({ message: 'boom' })).toBe(false);
  });

  it('should return false for null and undefined reasons', () => {
    expect(isBrowserExtensionError(null)).toBe(false);
    expect(isBrowserExtensionError(undefined)).toBe(false);
  });
});
