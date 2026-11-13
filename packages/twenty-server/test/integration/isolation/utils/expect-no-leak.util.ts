// A response body that merely omits the expected field can still leak the
// foreign record elsewhere (a list, a nested relation, an error message
// that echoes the input). Asserting on the full serialized body catches
// that; asserting only a specific field does not.
export const expectNoLeak = (
  body: unknown,
  foreign: { id?: string | null; name?: string | null; marker: string },
): void => {
  const serialized = JSON.stringify(body);

  if (foreign.id) {
    expect(serialized).not.toContain(foreign.id);
  }
  if (foreign.name) {
    expect(serialized).not.toContain(foreign.name);
  }
  expect(serialized).not.toContain(foreign.marker);
};
