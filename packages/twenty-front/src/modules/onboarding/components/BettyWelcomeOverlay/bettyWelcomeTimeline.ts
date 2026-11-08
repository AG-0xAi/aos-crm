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

// Cumulative scene starts (ms), in the Guion's order.
export const BETTY_WELCOME_READY_START_MS = 0;

export const BETTY_WELCOME_THREAD_START_MS =
  BETTY_WELCOME_READY_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.ready;

export const BETTY_WELCOME_FIGURE_START_MS =
  BETTY_WELCOME_THREAD_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.thread;

export const BETTY_WELCOME_TRANSFORMATION_START_MS =
  BETTY_WELCOME_FIGURE_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.figure;

export const BETTY_WELCOME_WELCOME_START_MS =
  BETTY_WELCOME_TRANSFORMATION_START_MS +
  BETTY_WELCOME_SCENE_DURATIONS_MS.transformation;

export const BETTY_WELCOME_DIM_START_MS =
  BETTY_WELCOME_WELCOME_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.welcome;

const sceneOrder = Object.values(BETTY_WELCOME_SCENE_DURATIONS_MS);

export const BETTY_WELCOME_DURATION_MS = sceneOrder.reduce(
  (sum, duration) => sum + duration,
  0,
);

export const BETTY_WELCOME_IRIS_OPEN_AT_MS =
  BETTY_WELCOME_DURATION_MS - BETTY_WELCOME_SCENE_DURATIONS_MS.iris;

// The dot pulses at most this long, past BETTY_WELCOME_IRIS_OPEN_AT_MS, waiting
// for the dashboard to report ready (assets/motion/betty-bienvenida-spec.md,
// montage step 4: "como máximo 4 s y luego abrir igualmente").
export const BETTY_WELCOME_IRIS_PULSE_CAP_MS = 4000;

// prefers-reduced-motion: same sequence, fades only, ~2.5s (assets/motion/betty-bienvenida-spec.md «Accesibilidad»).
export const BETTY_WELCOME_REDUCED_MOTION_DURATION_MS = 2500;
