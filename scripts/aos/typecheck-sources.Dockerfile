# CRM-004 fix2: the SOURCE half of the twenty-server typecheck environment.
#
# Why this is a Docker stage and not a `cp -r` inside the run container: the
# previous shape mounted four workspaces read-only off the Windows drive and
# copied them in on every gate. Measured on 2026-10-28 that copy took ~698 s
# per run before Nx even started, because every one of ~19000 files crossed
# drvfs. Here the same sources arrive once as a clean `git archive` tar, and
# Docker keys the layer on that tar's content: an unchanged source tree is a
# cache hit, and the dependency/SDK builds below are not re-run at all. When a
# source DOES change, the layer is rebuilt -- so the artifacts can never be
# stale with respect to the sources the compiler is about to read.
#
# The base is the dependency image scripts/aos/typecheck.Dockerfile produces
# (whole-monorepo `yarn install --immutable`, devDependencies kept, no
# --production prune, .yarnrc.yml's enableScripts:false intact). Built by
# scripts/aos/verify-server-typecheck.mjs; the context is a git archive of the
# workspace sources only -- no .git, no .aos, no deploy/local/.env, no
# node_modules, no pre-built dist.
ARG DEPS_IMAGE
FROM ${DEPS_IMAGE}

WORKDIR /app

COPY packages /app/packages

# The dependency closure twenty-server's tsconfig actually reads.
#
# The first three are the workspace libraries it imports at type level. The
# fourth is the one upstream's own `twenty-server:typecheck` target gets from
# its `dependsOn: ["^build"]` and that CRM-004-fix1 was missing:
# packages/twenty-server/scripts/build-seed-front-components.ts imports
# `twenty-sdk/front-component-renderer/build`, whose exports.types entry is
# dist/front-component-renderer/build/index.d.ts -- a BUILD OUTPUT. fix1 put
# that unresolved import on an allowlist and called the run clean; it was an
# omitted dependency artifact, not a type error in the code.
#
# Only the declaration half of twenty-sdk's official build target runs here
# (`tsgo --declaration --emitDeclarationOnly` + `tsc-alias`, verbatim from
# packages/twenty-sdk/project.json). The seven Vite bundles and the rollup
# .d.ts rollup in that target produce the RUNTIME artifacts and the rolled-up
# public entry points; neither is on the path twenty-server's typecheck reads,
# and building them would turn this command into a frontend build. The
# declarations emitted here are the compiler's own output over the real
# sources: nothing is stubbed, hand-written or excluded.
RUN set -e; \
    npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails --skip-nx-cache; \
    cd /app/packages/twenty-sdk; \
    npx tsgo -p tsconfig.lib.json --declaration --emitDeclarationOnly --noEmit false --outDir dist --rootDir src; \
    npx tsc-alias -p tsconfig.lib.json --outDir dist

# Fail the BUILD, not the gate's parser, if the artifact the server's typecheck
# resolves is absent or empty: a cached layer that silently lost it would
# otherwise come back as "module not found" and look like a source error.
RUN set -e; \
    test -s /app/packages/twenty-sdk/dist/front-component-renderer/build/index.d.ts; \
    test -s /app/packages/twenty-shared/dist/front-component-build/index.d.ts
