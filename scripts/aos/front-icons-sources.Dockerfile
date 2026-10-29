# CRM-005 (R3): the SOURCE half of the frontend icon-flag environment.
#
# Same shape and the same reasons as scripts/aos/server-specs-sources.Dockerfile
# (CRM-004 fix3): the sources arrive once as a clean `git archive` tar that
# Docker keys the layer on, instead of being copied out of the Windows mounts on
# every run. The base is the official Dockerfile's own `front-deps` stage,
# rebuilt from this run's lockfile by scripts/aos/verify-front-icons.mjs, so the
# component tests and the typecheck run against the dependency tree the real
# image installs.
#
# The library workspaces are copied and BUILT BEFORE twenty-front is copied: an
# edit under twenty-front (the four files CRM-005 touches and their tests) then
# invalidates only the last COPY, and the ~minutes-long workspace build above it
# stays a cache hit. Measured on this host: that ordering is what makes a
# must-fail-first run and the run after the fix affordable in the same session.
#
# No .git, no .aos, no deploy/local/.env, no node_modules, no pre-built dist: a
# git archive can only carry committed, tracked content.
ARG DEPS_IMAGE
FROM ${DEPS_IMAGE}

WORKDIR /app

COPY packages/twenty-shared /app/packages/twenty-shared
COPY packages/twenty-ui /app/packages/twenty-ui
COPY packages/twenty-sdk /app/packages/twenty-sdk
COPY packages/twenty-client-sdk /app/packages/twenty-client-sdk
COPY packages/twenty-front-component-renderer /app/packages/twenty-front-component-renderer

# The workspace libraries twenty-front resolves through node_modules symlinks
# (package exports point at dist, which is why jest and tsgo both need them
# built), with the Nx cache bypassed: an Nx cache hit would print a green
# summary without producing anything, and jest would then resolve whatever the
# layer happened to carry. The build log streams out of `docker build`, so a
# failure here is readable instead of an empty container exit.
RUN npx nx run-many -t build -p twenty-shared twenty-ui twenty-sdk twenty-client-sdk twenty-front-component-renderer --skip-nx-cache

# Fail the BUILD, not the gate's parser, if those artifacts are absent: a cached
# layer that silently lost them would otherwise surface as a module-resolution
# error inside jest and look like a failing component test.
RUN set -e; \
    for workspace in twenty-shared twenty-ui twenty-sdk twenty-client-sdk twenty-front-component-renderer; do \
      test "$(find /app/packages/$workspace/dist -type f | wc -l)" -gt 0 || \
        { echo "no build output under packages/$workspace/dist"; exit 1; }; \
    done

# MEASURED UPSTREAM PHANTOM DEPENDENCY. twenty-front imports lodash.groupby,
# lodash.isempty, lodash.omit, lodash.uniqby and pluralize, but their @types
# packages are declared ONLY by twenty-server (and twenty-website), so a focus
# that installs the frontend workspaces alone resolves the modules and not
# their declarations: tsgo then reports TS7016 for each one, in untouched
# upstream files. A full-monorepo `yarn install` hides this by hoisting those
# @types into the root node_modules. The declarations are restored here at the
# EXACT specs twenty-server declares -- read out of its package.json, never
# written by hand, and failing the build if one is gone -- so the compiler sees
# what the full install hoists. Installed into a throwaway prefix and copied in,
# never `npm install` against /app: npm would reconcile the whole yarn-installed
# tree.
COPY packages/twenty-server/package.json /aos/twenty-server-package.json
RUN set -e; \
    specs="$(node -e "const d=require('/aos/twenty-server-package.json').devDependencies; \
      const names=['@types/lodash.groupby','@types/lodash.isempty','@types/lodash.omit','@types/lodash.uniqby','@types/pluralize']; \
      const missing=names.filter((n)=>!d[n]); \
      if (missing.length) { console.error('twenty-server no longer declares: '+missing.join(', ')); process.exit(1); } \
      console.log(names.map((n)=>n+'@'+d[n]).join(' '));")"; \
    echo "restoring hoisted declarations: $specs"; \
    npm install --no-save --no-package-lock --no-fund --no-audit --prefix /tmp/aos-types $specs; \
    cp -r /tmp/aos-types/node_modules/@types/. /app/node_modules/@types/; \
    rm -rf /tmp/aos-types

# The workspace-root jest preset twenty-front's jest.config.mjs extends. Not
# part of the official front-deps stage (the image never runs tests), and
# without it jest exits with "Preset ../../jest.preset.js not found".
COPY jest.preset.js /app/jest.preset.js

COPY packages/twenty-front /app/packages/twenty-front
