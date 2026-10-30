# CRM-005 (R1): the browser half of the functional acceptance.
#
# Base: the OFFICIAL Playwright image, pinned by digest by
# scripts/aos/test/crm-browser-e2e.test.mjs (never a moving tag). The image
# ships the browsers under /ms-playwright but no longer ships the `playwright`
# npm package, so the version-matched package is installed here -- at BUILD
# time, from the npm registry, which is an external destination inventoried in
# docs/aos/bootstrap/TELEMETRY_AUDIT.md. The acceptance run itself gets
# --network host (it has to reach the CRM on loopback) but downloads nothing:
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps the install from fetching browsers the
# image already carries, and a mismatch between the package and those browsers
# would fail the check below instead of silently launching another build.
#
# The container runs as the image's own unprivileged pwuser (not root) so the
# CHROMIUM SANDBOX STAYS ON: Chromium refuses its sandbox when it runs as root,
# and the usual workaround -- --no-sandbox -- would mean measuring a browser
# nobody should use. No added capability, no seccomp override.
ARG BROWSER_IMAGE
FROM ${BROWSER_IMAGE}

ARG PLAYWRIGHT_VERSION

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_PATH=/usr/lib/node_modules

RUN npm install -g --no-fund --no-audit "playwright@${PLAYWRIGHT_VERSION}" \
    && npm cache clean --force

# Fail the BUILD, not the suite, if the package is not resolvable or is not the
# version this image's browsers were built for.
RUN node -e "const v = require('playwright/package.json').version; \
    if (v !== process.env.PLAYWRIGHT_VERSION) { console.error('playwright ' + v + ' != ' + process.env.PLAYWRIGHT_VERSION); process.exit(1); } \
    const { chromium } = require('playwright'); \
    if (!chromium) { console.error('no chromium in the playwright package'); process.exit(1); } \
    console.log('playwright ' + v + ' with browsers from ' + process.env.PLAYWRIGHT_BROWSERS_PATH);"

COPY browser-acceptance.mjs /aos/browser-acceptance.mjs
# CRM-019 adds the brand acceptance to the SAME image: one pinned browser, one
# build, two suites (scripts/aos/test/crm-brand-e2e.test.mjs).
COPY brand-acceptance.mjs /aos/brand-acceptance.mjs

USER pwuser
WORKDIR /aos
