import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';

const FOREIGN_ID = 'foreign-id-123';
const FOREIGN_NAME = 'Foreign Record Name';
const MARKER = 'iso-marker-456';

describe('expectNoLeak', () => {
  it('passes a not-found error that only echoes the caller-supplied id when skipIdInErrorMessages is set', () => {
    const body = {
      data: null,
      errors: [{ message: `Logic function with id ${FOREIGN_ID} not found` }],
    };

    expect(() =>
      expectNoLeak(
        body,
        { id: FOREIGN_ID, name: FOREIGN_NAME, marker: MARKER },
        { skipIdInErrorMessages: true },
      ),
    ).not.toThrow();
  });

  it('fails when the id leaks through the data payload even with skipIdInErrorMessages set', () => {
    const body = {
      data: { findOneLogicFunction: { id: FOREIGN_ID } },
      errors: undefined,
    };

    expect(() =>
      expectNoLeak(
        body,
        { id: FOREIGN_ID, name: FOREIGN_NAME, marker: MARKER },
        { skipIdInErrorMessages: true },
      ),
    ).toThrow();
  });

  it('fails when the name leaks through the error message even with skipIdInErrorMessages set', () => {
    const body = {
      data: null,
      errors: [{ message: `Logic function "${FOREIGN_NAME}" not found` }],
    };

    expect(() =>
      expectNoLeak(
        body,
        { id: FOREIGN_ID, name: FOREIGN_NAME, marker: MARKER },
        { skipIdInErrorMessages: true },
      ),
    ).toThrow();
  });

  it('fails when the marker leaks through the error message even with skipIdInErrorMessages set', () => {
    const body = {
      data: null,
      errors: [{ message: `Execution of ${MARKER} failed` }],
    };

    expect(() =>
      expectNoLeak(
        body,
        { id: FOREIGN_ID, name: FOREIGN_NAME, marker: MARKER },
        { skipIdInErrorMessages: true },
      ),
    ).toThrow();
  });

  it('fails on an id-echoing error without the skipIdInErrorMessages option', () => {
    const body = {
      data: null,
      errors: [{ message: `Logic function with id ${FOREIGN_ID} not found` }],
    };

    expect(() =>
      expectNoLeak(body, {
        id: FOREIGN_ID,
        name: FOREIGN_NAME,
        marker: MARKER,
      }),
    ).toThrow();
  });
});
