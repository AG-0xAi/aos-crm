# CRM-022 — Betty welcome layer screenshots

Captured from the `Modules/Onboarding/BettyWelcomeOverlay` Storybook story (`Default`, `DefaultEs`,
`ReducedMotion`) with Playwright/Chromium (`playwright@1.60.0`, the version pinned in
`packages/twenty-front/package.json`), against `storybook:serve:dev --configuration=modules` on
`localhost:6006`. Full-motion frames are at the approximate choreography timestamps described in
`assets/motion/betty-bienvenida-spec.md`'s scene table (card ~0.9 s, figure ~4.5 s, wordmark +
greeting ~8.2 s, iris opening ~10.4-10.6 s — slightly earlier on the 390 px viewport, since the
mask's fixed-radius growth covers a smaller screen sooner on the same clock). Reduced-motion
frames are at ~0.3 s (card), ~1.0 s (wordmark + greeting), ~2.2 s (dark, pre-reveal).

Real sign-up screenshots from the deployed beta come after the deploy, not in this run.

## English, 1440 px (`en-desktop-*.png`)
- `en-desktop-card.png` — scene 1, the "Your space is ready." card with the three setup rows and the postmark.
- `en-desktop-figure.png` — scenes 2-3 (thread + figure), simplified to a drawn thread and a hopping dot (see report for why).
- `en-desktop-greeting.png` — scenes 4-5, the betty wordmark, "Welcome, Charles." and the English signed phrase "Relationships worth keeping."
- `en-desktop-iris.png` — scene 7, the iris opening mid-transition over the charcoal dim.

## English, 390 px (`en-mobile-*.png`)
Same four frames at the mobile viewport; the card scales to `min(460px, 90vw)` so it no longer overflows.

## Spanish, 1440 px (`es-desktop-*.png`)
Same four frames with `i18n` activated to `es-ES`: "Configuración inicial · 3 de 3", "Tu espacio está listo.", "Te damos la bienvenida, Charles.", "Relaciones que dejan huella." (the approved Spanish signature asset), and "Saltar animación" on the skip button.

## Spanish, 390 px (`es-mobile-*.png`)
Same four frames at the mobile viewport.

## Reduced motion (`reduced-motion-*.png`)
`prefers-reduced-motion: reduce` forced via a mocked `window.matchMedia`, English, at both viewports:
- `*-card.png` — the card, faded in only (no thread/figure/iris).
- `*-welcome.png` — the wordmark and greeting, faded in only.
- `*-dashboard.png` — the dark pre-reveal frame, just before the layer unmounts at ~2.5 s.
