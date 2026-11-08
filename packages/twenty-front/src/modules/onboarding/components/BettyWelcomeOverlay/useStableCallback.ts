import { useRef } from 'react';

// Keeps `callback` callable through a ref that's always up to date, behind a
// wrapper identity that never changes across renders. Lets an effect depend
// on the wrapper without re-running every time the caller passes a new
// function instance (e.g. a prop recreated on every parent render).
export const useStableCallback = <Args extends unknown[], Return>(
  callback: (...args: Args) => Return,
) => {
  // oxlint-disable-next-line twenty/no-state-useref -- holds the latest callback; never read during render.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // oxlint-disable-next-line twenty/no-state-useref -- the wrapper's identity must stay stable across renders.
  const stableRef = useRef((...args: Args) => callbackRef.current(...args));

  return stableRef.current;
};
