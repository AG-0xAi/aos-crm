// Scene durations (ms), from assets/motion/betty-bienvenida-spec.md's «Guion» table.
export const BETTY_WELCOME_SCENE_DURATIONS_MS = {
  ready: 2000,
  thread: 1600,
  figure: 2200,
  transformation: 1600,
  welcome: 2000,
  dim: 1200,
  iris: 1600,
} as const;

const sceneOrder = Object.values(BETTY_WELCOME_SCENE_DURATIONS_MS);

export const BETTY_WELCOME_DURATION_MS = sceneOrder.reduce(
  (sum, duration) => sum + duration,
  0,
);

export const BETTY_WELCOME_IRIS_OPEN_AT_MS =
  BETTY_WELCOME_DURATION_MS - BETTY_WELCOME_SCENE_DURATIONS_MS.iris;

// prefers-reduced-motion: same sequence, fades only, ~2.5s (assets/motion/betty-bienvenida-spec.md «Accesibilidad»).
export const BETTY_WELCOME_REDUCED_MOTION_DURATION_MS = 2500;
