# CRM-004: the dependency tree for a REAL twenty-server typecheck.
#
# The official Dockerfile's `server-deps` stage exists to produce a runtime, so
# it focuses the five workspaces the server needs to boot and then prunes to
# --production. `tsgo -p tsconfig.json` measured in that tree reports absent
# modules, which says nothing about the code's types.
#
# Nor is twenty-server's own declared closure enough: measured there, tsgo
# reports 13 errors, 11 of them "no declaration file for module 'semver'".
# @types/semver@^7.5.8 and graphql-sse@^2.5.4 ARE in the lockfile, declared by
# twenty-cli/twenty-front/twenty-sdk, and a monorepo-wide install hoists them to
# the root node_modules where twenty-server resolves them. Those errors are a
# property of the install scope, not of the code -- which is why this image
# installs the WHOLE workspace set, the way upstream typechecks it.
#
# Built by scripts/aos/verify-server-typecheck.mjs from a tar context holding
# only the manifests, never the checkout. Same pinned base and same
# telemetry/lifecycle-script policy as the official Dockerfile: .yarnrc.yml
# carries enableScripts:false and it is copied in, not bypassed.
FROM node:24.22.1-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2

ENV YARN_ENABLE_TELEMETRY=0 \
    NX_NO_CLOUD=true \
    NX_DAEMON=false

WORKDIR /app

# The build context contains exactly the manifests and Yarn runtime files, so
# this copies the dependency inputs and nothing else.
COPY . /app/

RUN yarn install --immutable \
 && yarn cache clean \
 && npx nx reset
