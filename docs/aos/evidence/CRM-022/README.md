# CRM-022 — Betty welcome layer screenshots

Captured from the `Modules/Onboarding/BettyWelcomeOverlay` Storybook story (`Default`, `DefaultEs`,
`ReducedMotion`) with Playwright/Chromium (`playwright@1.60.0`, the version pinned in
`packages/twenty-front/package.json`), against `storybook:serve:dev --configuration=modules` on
`localhost:6006`. The story marks the dashboard behind the layer ready from mount (the happy
path), so the iris opens on schedule instead of pulsing.

Full-motion frames are at the choreography timestamps from
`assets/motion/betty-bienvenida-spec.md`'s scene table, timed from when the Skip button first
renders (not from navigation start, to absorb cold-compile jitter): card ~0.9 s, figure ~5.6 s
(walking + the wave), transformation ~6.7 s (strands mid-trace, into the wordmark), greeting
~8.9 s, iris opening ~10.6-10.7 s on the 1440 px viewport and ~10.6 s on the 390 px one — the
mask's fixed-radius growth covers the smaller screen sooner on the same clock, so its frame is a
little earlier. Reduced-motion frames are at ~0.3 s (card), ~1.0 s (wordmark + greeting), ~2.2 s
(dark, pre-reveal).

Real sign-up screenshots from the deployed beta come after the deploy, not in this run.

## English, 1440 px (`en-desktop-*.png`)
- `en-desktop-card.png` — scene 1, the "Your space is ready." card with the three setup rows and the postmark.
- `en-desktop-figure.png` — scene 3, the faceless thread figure (head = the dot, body + limbs = the
  thread's stroke) mid-walk, waving one arm.
- `en-desktop-transformation.png` — scene 4, the figure's thread unravelling into four strands that
  trace and fill the real "b · e · tt · y" glyphs; here "b", "e" and "tt" are already filled in
  charcoal and "y" is still tracing its outline, with the dot about to land as the final period.
- `en-desktop-greeting.png` — scenes 4-5 resolved: the approved betty wordmark `<img>`, "Welcome,
  Charles." and the English signed phrase "Relationships worth keeping."
- `en-desktop-iris.png` — scene 7, the iris opening mid-transition over the charcoal dim, the
  terracotta ring visible at its edge.

## English, 390 px (`en-mobile-*.png`)
Same five frames at the mobile viewport; the card scales to `min(460px, 90vw)` so it no longer
overflows.

## Spanish, 1440 px (`es-desktop-*.png`)
Same five frames with `i18n` activated to `es-ES`: "Configuración inicial · 3 de 3", "Tu espacio
está listo.", "Te damos la bienvenida, Charles.", "Relaciones que dejan huella." (the approved
Spanish signature asset), and "Saltar animación" on the skip button.

## Spanish, 390 px (`es-mobile-*.png`)
Same five frames at the mobile viewport.

## Reduced motion (`reduced-motion-*.png`)
`prefers-reduced-motion: reduce` forced via a mocked `window.matchMedia`, English, at both viewports:
- `*-card.png` — the card, faded in only (no thread/figure/iris).
- `*-welcome.png` — the wordmark and greeting, faded in only.
- `*-dashboard.png` — the dark pre-reveal frame, just before the layer unmounts at ~2.5 s.
