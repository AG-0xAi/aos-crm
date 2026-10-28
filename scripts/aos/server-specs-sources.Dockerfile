# CRM-004 fix3: the SOURCE half of the CRM-003 privacy-specs environment.
#
# Why this is a Docker stage and not a `cp -r` inside the run container: the
# previous shape mounted the four workspaces read-only off the Windows drive
# and copied them in on every gate. Measured on 2026-10-28 that copy outlived
# the command's whole 1200 s quota (exit 124) while sitting at ~3 % CPU,
# because every one of ~19000 files crossed drvfs; earlier runs paid 193-393 s
# for the same copy. Here the same sources arrive once as a clean `git archive`
# tar and Docker keys the layer on that tar's content: an unchanged source tree
# is a cache hit and the dependency build below is not re-run at all. When a
# source DOES change, the layer is rebuilt, so the artifacts can never be stale
# with respect to the specs about to run.
#
# The base is the official Dockerfile's own `server-deps` stage, rebuilt from
# this run's lockfile by scripts/aos/verify-server-specs.mjs. That is kept
# deliberately: the gate's claim is that these specs run against the
# dependency tree the real image installs, so this does NOT reuse
# scripts/aos/typecheck-sources.Dockerfile's image, whose closure is a
# whole-monorepo install for a different purpose.
#
# The COPY below is the same four workspaces the official `twenty-server-build`
# stage copies out of this repo, and the context is a git archive of them: no
# .git, no .aos, no deploy/local/.env, no node_modules, no pre-built dist.
ARG DEPS_IMAGE
FROM ${DEPS_IMAGE}

WORKDIR /app

COPY packages /app/packages

# The workspace libraries twenty-server imports at runtime, built from source
# with the Nx cache bypassed: an Nx cache hit would print a green summary
# without producing anything, and jest would then resolve these from whatever
# the layer happened to carry. The build log streams out of `docker build`, so
# a failure here is readable instead of an empty container exit.
# NX_DAEMON/NX_NO_CLOUD already come from the official node-base stage.
RUN npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails --skip-nx-cache

# Fail the BUILD, not the gate's parser, if the dependency artifacts are
# absent: a cached layer that silently lost them would otherwise surface as a
# module-resolution error inside jest and look like a failing spec.
RUN set -e; \
    test "$(find /app/packages/twenty-shared/dist /app/packages/twenty-client-sdk/dist /app/packages/twenty-emails/dist -type f | wc -l)" -gt 0
