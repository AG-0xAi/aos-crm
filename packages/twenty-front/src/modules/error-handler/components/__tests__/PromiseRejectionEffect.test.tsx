import { act, render } from '@testing-library/react';

import { PromiseRejectionEffect } from '@/error-handler/components/PromiseRejectionEffect';

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

const mockEnqueueToast = jest.fn();

jest.mock('twenty-ui/components/feedback', () => ({
  ...jest.requireActual('twenty-ui/components/feedback'),
  useToast: () => ({ enqueueToast: mockEnqueueToast }),
}));

const dispatchUnhandledRejection = async (reason: unknown) => {
  await act(async () => {
    const event = new Event('unhandledrejection') as PromiseRejectionEvent & {
      reason: unknown;
    };
    Object.defineProperty(event, 'reason', { value: reason });
    Object.defineProperty(event, 'promise', { value: Promise.resolve() });
    window.dispatchEvent(event);
    await Promise.resolve();
  });
};

describe('PromiseRejectionEffect', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should not show a toast and should warn when the rejection comes from a browser extension', async () => {
    render(<PromiseRejectionEffect />);

    const error = new Error('Failed to connect to MetaMask');
    error.stack = 'Error: boom\n at chrome-extension://abcdefg/inject.js:1:1';

    await dispatchUnhandledRejection(error);

    expect(mockEnqueueToast).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Ignoring unhandled rejection from a browser extension:',
      error,
    );
  });

  it('should still show a toast for an application rejection', async () => {
    render(<PromiseRejectionEffect />);

    const error = new Error('Something broke in the app');
    error.stack = 'Error: boom\n at https://app.example.com/main.js:1:1';

    await dispatchUnhandledRejection(error);

    expect(mockEnqueueToast).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
