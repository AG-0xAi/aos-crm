# CRM-004: the dependency tree for a REAL twenty-server typecheck.
#
# The official Dockerfile's `server-deps` stage exists to produce a runtime, so
# it focuses the five workspaces the server needs to boot and then prunes to
# --production. `tsgo -p tsconfig.json` measured in that tree reports absent
# modules, which says nothing about the code's types. This image is the other
# half of the measurement: twenty-server's DECLARED dependency closure
# (including twenty-oxlint-rules, which the runtime stage legitimately leaves
# out) with devDependencies kept, and no --production prune.
#
# Built by scripts/aos/verify-server-typecheck.mjs from a tar context holding
# only the manifests below, never the checkout. Same pinned base and same
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

RUN yarn workspaces focus twenty-monorepo twenty-server twenty-emails twenty-shared twenty-client-sdk twenty-oxlint-rules \
 && yarn cache clean \
 && npx nx reset
