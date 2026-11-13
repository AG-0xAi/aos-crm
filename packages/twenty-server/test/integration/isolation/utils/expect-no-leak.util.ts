// A response body that merely omits the expected field can still leak the
// foreign record elsewhere (a list, a nested relation, an error message
// that echoes the input). Asserting on the full serialized body catches
// that; asserting only a specific field does not.
//
// A "not found" error is the one place the id itself is expected to come
// back: the server echoes the caller's own input, not a leak. With
// skipIdInErrorMessages, the id check is skipped inside body.errors only;
// data payloads and the name/marker still have to be absent everywhere.
export const expectNoLeak = (
  body: unknown,
  foreign: { id?: string | null; name?: string | null; marker: string },
  options: { skipIdInErrorMessages?: boolean } = {},
): void => {
  const { skipIdInErrorMessages = false } = options;

  if (
    skipIdInErrorMessages &&
    typeof body === 'object' &&
    body !== null &&
    'errors' in body
  ) {
    const { errors, ...rest } = body as { errors?: unknown } & Record<
      string,
      unknown
    >;
    const restSerialized = JSON.stringify(rest);
    const errorsSerialized = JSON.stringify(errors ?? null);

    if (foreign.id) {
      expect(restSerialized).not.toContain(foreign.id);
    }
    if (foreign.name) {
      expect(restSerialized).not.toContain(foreign.name);
      expect(errorsSerialized).not.toContain(foreign.name);
    }
    expect(restSerialized).not.toContain(foreign.marker);
    expect(errorsSerialized).not.toContain(foreign.marker);

    return;
  }

  const serialized = JSON.stringify(body ?? null);

  if (foreign.id) {
    expect(serialized).not.toContain(foreign.id);
  }
  if (foreign.name) {
    expect(serialized).not.toContain(foreign.name);
  }
  expect(serialized).not.toContain(foreign.marker);
};
