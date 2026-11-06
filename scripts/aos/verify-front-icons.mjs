#!/usr/bin/env node
// CRM-005 (R3): runs the frontend icon-flag component tests and the twenty-front
// typecheck for real, inside the dependency tree the official image installs.
//
// What this exists to measure. The local profile pins the official
// ALLOW_REQUESTS_TO_TWENTY_ICONS=false (deploy/local/privacy.env), but three
// frontend consumers built the external icon URL without ever reading that flag
// -- the sign-in background decoration, the onboarding import preview and the
// navigation-link favicon -- and the frontend state behind the flag defaulted to
// TRUE before /client-config answered, so even a consumer that reads it could
// fire on the first render. A static grep cannot tell a fixed consumer from a
// broken one; a render can. These four suites render the real components with
// synthetic non-empty domains/links, with the provider request intercepted
// instead of performed, and they fail if any of them asks for an icon with the
// flag off.
//
// The typecheck is here for the same reason the tests are: the four files this
// track edits are TypeScript in twenty-front, and `vite build` (which is what
// the image build runs) does not typecheck. The verdict is tsgo's own exit code
// plus a canary file that tsgo MUST reject, because a compiler that exits 0 on
// deliberately broken code measured nothing.
//
// Fail-closed throughout: if WSL, Docker, either image build or the container
// run cannot be measured, this exits non-zero. It never degrades to "skipped".
//
//   node scripts/aos/verify-front-icons.mjs
//   node scripts/aos/verify-front-icons.mjs --self-test   (no WSL, no Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { globSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveGateFile } from './verify-brand.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const SOURCES_DOCKERFILE = 'scripts/aos/front-icons-sources.Dockerfile';

// Per-run names for every temporary resource, for the reason CRM-004 fix5
// documents: two gates at once (one worker per worktree) must not overwrite each
// other's tar or move each other's tag. The BuildKit layer cache is keyed on
// context content and base digest, not on the output tag, so this changes what
// is NAMED and not what is rebuilt -- which is also why this still shares its
// front-deps cache with the image build.
export function newRunId() {
  return `${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function runResourceNames(runId) {
  return {
    depsImage: `aos-crm-local/front-deps:gate-${runId}`,
    sourcesImage: `aos-crm-local/front-icons:gate-${runId}`,
    sourceTar: `/tmp/aos-crm-front-icons-sources-${runId}.tar`,
    // Written by Windows git, read by the distro through /mnt. Per-run like
    // every other temporary name, for the reason CRM-004 fix5 documents.
    windowsSourceTar: resolve(tmpdir(), `aos-crm-front-icons-sources-${runId}.tar`),
    containerName: `aos-crm-front-icons-gate-${runId}`,
  };
}

const RUN_ID = newRunId();
const {
  depsImage: DEPS_IMAGE,
  sourcesImage: SOURCES_IMAGE,
  sourceTar: SOURCE_TAR,
  windowsSourceTar: WINDOWS_SOURCE_TAR,
  containerName: CONTAINER_NAME,
} = runResourceNames(RUN_ID);

const ownImages = [];
// See verify-server-specs.mjs: without this a fully cached rebuild still gets a
// new image id (the provenance attestation carries its own timestamps), and
// `FROM ${DEPS_IMAGE}` would then invalidate the source layer on every run.
const NO_ATTESTATION = '--provenance=false';

// The four suites that cover the flag. The first three are the consumers this
// track fixes, each rendering the real component; the fourth is the existing
// upstream coverage of the shared LINKS image identifier, kept in the same run
// so a regression there cannot pass unnoticed.
export const SPECS = [
  'src/modules/sign-in-background-mock/components/__tests__/BackgroundMockTableRow.test.tsx',
  'src/modules/onboarding/components/import-contacts/__tests__/OnboardingImportPreviewCompanies.test.tsx',
  'src/modules/navigation-menu-item/display/link/components/__tests__/LinkIconWithLinkOverlay.test.tsx',
  'src/modules/object-metadata/utils/__tests__/getImageIdentifierFieldValue.test.ts',
  // CRM-019 (R4): the component the new onboarding step and Settings > AI >
  // MCP both render, and the MCP link builders whose connector name and server
  // key the brand change moved.
  'src/modules/settings/mcp/components/__tests__/McpConnectAssistant.test.tsx',
  'src/modules/settings/mcp/utils/__tests__/mcpSetup.test.ts',
  // CRM-016 (R4): the invited person's own screen. The address arrives in the
  // link and the invitation is what locks it, which no server test can see.
  'src/modules/auth/sign-in-up/components/internal/__tests__/SignInUpEmailField.test.tsx',
  // CRM-016 fix1: every document the sign-up-invitations hook sends to the
  // server carries the SignUpInvitationFragment definition it spreads, not
  // only a reference to it -- the review finding this closes (part 6) was the
  // refetchQueries document failing with "Unknown fragment" in production.
  'src/modules/settings/admin-panel/sign-up-invitations/hooks/__tests__/useSignUpInvitations.test.ts',
];
const EXPECTED_SUITES = SPECS.length;

// The three components whose render these tests measure, and the state file
// behind them, as paths inside twenty-front. The self-test reads these, so a
// consumer that stops reading the flag is a failure here too, not only in jest.
export const GUARDED_COMPONENTS = [
  'src/modules/sign-in-background-mock/components/BackgroundMockTableRow.tsx',
  'src/modules/onboarding/components/import-contacts/OnboardingImportPreviewCompanies.tsx',
  'src/modules/navigation-menu-item/display/link/components/LinkIconWithLinkOverlay.tsx',
];
export const FLAG_STATE_FILE =
  'src/modules/client-config/states/allowRequestsToTwentyIcons.ts';

// The two things twenty-front's own program carries that `include` does not
// pull in by import resolution, because nothing imports them: the ambient
// declarations (src/types/global.d.ts declares `Window._env_`, which
// src/config/index.ts reads) and the jest setup file, whose
// `import '@testing-library/jest-dom'` is what registers the DOM matchers the
// suites below use. A program narrowed to the changed files and their imports
// loses both, and tsgo then rejects untouched upstream code -- measured on
// 2026-10-30: TS2339 on `_env_` in src/config/index.ts plus seven TS2339 on
// `toBeInTheDocument` in the three icon suites. These are the project's own
// files, not a relaxation: both are in twenty-front/tsconfig.json's `include`,
// which the self-test checks, so the scoped program stays a subset of it.
export const AMBIENT_PROGRAM_FILES = ['src/**/*.d.ts', 'setupTests.ts'];

// WHAT THE TYPECHECK COVERS, and why it is not the whole twenty-front project.
// Measured on 2026-10-29 in this same image: `tsgo -p tsconfig.json` over all
// of twenty-front reports TS7016 in six untouched upstream files, because the
// @types packages for lodash.groupby/isempty/omit/uniqby and pluralize are
// declared only by twenty-server -- a phantom dependency a full-monorepo
// install hides by hoisting. The sources image restores exactly those
// declarations, and the program typechecked here is the four files this track
// changes plus their tests, the project's own ambient declarations and jest
// setup (AMBIENT_PROGRAM_FILES) and everything all of those import (which does
// include the jotai/cookie-storage chain that TS7016 hit). The whole-project
// run, its remaining diagnostics and their causes are reported in
// docs/aos/bootstrap/FUNCTIONAL_EVIDENCE.md instead of silently dropped.
// CRM-019 widened this from the four files CRM-005 changed to the whole
// project. CRM-005 scoped it because a full run reported TS7016 in six
// untouched upstream files whose @types only twenty-server declares -- and the
// sources image now restores exactly those declarations, so the narrowing has
// no reason left. CRM-019 also touches ~60 front files, which a hand-kept list
// would drift from within one track.
export const TYPECHECK_INCLUDE = ['src/**/*'];
const SCOPED_TSCONFIG = 'tsconfig.aos-gate.json';

// Exactly what the official Dockerfile's `front-deps` stage COPYs, plus the
// Dockerfile itself. Rebuilt from a tar of these paths on EVERY run: "the tag
// exists" is not evidence that the dependencies behind it match today's
// lockfile. A plain tar of the working tree, not a git archive -- git archive
// normalizes modes and mtimes and would miss the layer cache the image build
// already warmed (measured in CRM-004 fix3).
export const DEPS_CONTEXT_PATHS = [
  'package.json',
  'yarn.lock',
  '.yarnrc.yml',
  'tsconfig.base.json',
  'nx.json',
  '.yarn/releases',
  '.yarn/patches',
  'packages/twenty-docker/twenty/Dockerfile',
  'packages/twenty-ui/package.json',
  'packages/twenty-shared/package.json',
  'packages/twenty-front/package.json',
  'packages/twenty-front-component-renderer/package.json',
  'packages/twenty-sdk/package.json',
  'packages/twenty-client-sdk/package.json',
];

// Everything that reaches a build context from the WORKING TREE rather than
// through `git archive HEAD`, which is the exact list the uncommitted-change
// check has to cover (CRM-004 fix4: the sources Dockerfile escaped it once).
export const WORKING_TREE_CONTEXT_PATHS = [...DEPS_CONTEXT_PATHS, SOURCES_DOCKERFILE];

// The six workspaces the official `twenty-front-build` stage copies. They
// arrive as a git archive layer, so the container never reads deploy/local/.env,
// .aos/ or .git, and the working tree is never written to.
export const FRONT_SOURCE_PACKAGES = [
  'twenty-shared',
  'twenty-ui',
  'twenty-sdk',
  'twenty-client-sdk',
  'twenty-front-component-renderer',
  'twenty-front',
];

// Everything the source context carries, all of it from `git archive HEAD`:
// those workspaces, the workspace-root jest preset twenty-front's jest config
// extends (absent from the official front-deps stage, which never runs tests),
// and twenty-server's manifest, read for the @types specs the sources image
// restores -- see the Dockerfile.
export const ARCHIVE_PATHS = [
  ...FRONT_SOURCE_PACKAGES.map((p) => `packages/${p}`),
  'jest.preset.js',
  'packages/twenty-server/package.json',
  // CRM-019: the theme-token generator formats its own output with oxfmt,
  // which resolves this config from the file location, so the drift check
  // needs it in the context.
  '.oxfmtrc.jsonc',
];

// Budgets, not "however long it takes". Their sum stays under the gate quota
// declared in .aos/verify.json, which is what makes the teardown happen here
// instead of after the harness has killed this process.
const DEPS_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_FRONT_DEPS_TIMEOUT_MS || 600_000);
const SOURCES_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_FRONT_SOURCES_TIMEOUT_MS || 900_000);
const RUN_TIMEOUT_MS = Number(process.env.AOS_CRM_FRONT_RUN_TIMEOUT_MS || 840_000);
const CLEANUP_TIMEOUT_MS = Number(process.env.AOS_CRM_CLEANUP_TIMEOUT_MS || 30_000);
// The container runs five steps now, and forty lines of tail is jest's output
// alone: it hid the typecheck diagnostics behind it (measured 2026-10-30, a run
// reported tsgo=2 with no error in sight).
const FAILURE_TAIL_LINES = 250;

// Markers, not exit codes of a shell pipeline: the container runs three things
// and `sh -c` would report only the last one.
const MARKERS = {
  jest: 'AOS_FRONT_JEST_EXIT',
  tsgo: 'AOS_FRONT_TSGO_EXIT',
  canary: 'AOS_FRONT_CANARY_EXIT',
  // CRM-019: the repo's own formatter over the same sources. tsgo accepts
  // plenty that `nx lint twenty-front` rejects, and formatting drift from a
  // large hand-written diff is the red a reviewer finds too late. Only oxfmt,
  // not oxlint: twenty-front's .oxlintrc.json names a jsPlugin built from
  // twenty-oxlint-rules, which this image does not build.
  lint: 'AOS_FRONT_LINT_EXIT',
  // CRM-019: twenty-ui's theme CSS and theme constants are GENERATED from
  // design-tokens. An edited token source committed without regenerating is
  // invisible in review and silently serves the old palette, so the generator
  // runs in --check mode here.
  tokens: 'AOS_UI_TOKENS_EXIT',
};

export function readMarker(output, name) {
  const match = output.match(new RegExp(`^${name}=(-?\\d+)$`, 'm'));
  return match ? Number(match[1]) : null;
}

export function parseJestSummary(output) {
  const suites = output.match(/^Test Suites:.*?(\d+) passed, (\d+) total$/m);
  const tests = output.match(/^Tests:.*?(\d+) passed, (\d+) total$/m);
  if (!suites || !tests) return { ok: false, detail: 'no Test Suites/Tests summary in jest output' };
  const [, suitesPassed, suitesTotal] = suites.map(Number);
  const [, testsPassed, testsTotal] = tests.map(Number);
  if (suitesTotal < EXPECTED_SUITES) {
    return { ok: false, detail: `expected at least ${EXPECTED_SUITES} suites, jest ran ${suitesTotal}` };
  }
  if (testsTotal === 0) return { ok: false, detail: 'jest ran 0 tests' };
  if (suitesPassed !== suitesTotal || testsPassed !== testsTotal) {
    return { ok: false, detail: `${suitesPassed}/${suitesTotal} suites and ${testsPassed}/${testsTotal} tests passed` };
  }
  return { ok: true, detail: `${suitesPassed}/${suitesTotal} suites, ${testsPassed}/${testsTotal} tests passed` };
}

// The whole verdict, so the self-test can cover every fail-closed path without
// Docker. Both builds and the container run are things THIS wrapper executed:
// nothing printed inside the container is believed until all three completed.
export function judgeFrontRun({ depsBuildStatus, sourcesBuildStatus, containerStatus, output = '' }) {
  if (depsBuildStatus !== 0) {
    return { ok: false, detail: `the official front-deps stage exited ${depsBuildStatus ?? 'unmeasured'}: the dependency tree these tests run against was never installed` };
  }
  if (sourcesBuildStatus !== 0) {
    return { ok: false, detail: `the source/library-build image exited ${sourcesBuildStatus ?? 'unmeasured'}: the workspace artifacts jest and tsgo resolve were not produced` };
  }
  if (containerStatus !== 0) {
    return { ok: false, detail: `the frontend container exited ${containerStatus ?? 'unmeasured'} instead of completing: nothing it printed can be trusted` };
  }
  const jestExit = readMarker(output, MARKERS.jest);
  const tsgoExit = readMarker(output, MARKERS.tsgo);
  const canaryExit = readMarker(output, MARKERS.canary);
  const lintExit = readMarker(output, MARKERS.lint);
  const tokensExit = readMarker(output, MARKERS.tokens);
  if (jestExit === null || tsgoExit === null || canaryExit === null || lintExit === null || tokensExit === null) {
    return { ok: false, detail: `the container did not report all five markers (jest=${jestExit}, tsgo=${tsgoExit}, canary=${canaryExit}, lint=${lintExit}, tokens=${tokensExit})` };
  }
  const summary = parseJestSummary(output);
  // The markers travel with the summary failure: the container's tail is what
  // gets printed, and without them a jest failure hides whether tsgo ran at all.
  if (!summary.ok) {
    return { ok: false, detail: `${summary.detail} (markers: jest=${jestExit}, tsgo=${tsgoExit}, canary=${canaryExit})` };
  }
  if (jestExit !== 0) {
    return { ok: false, detail: `jest exited ${jestExit} with a summary that reads clean; the exit code wins` };
  }
  if (tsgoExit !== 0) {
    return { ok: false, detail: `tsgo rejected twenty-front (exit ${tsgoExit})` };
  }
  if (lintExit !== 0) {
    return { ok: false, detail: `oxfmt reported unformatted sources in twenty-front (exit ${lintExit}); fix with: npx nx lint twenty-front --configuration=fix` };
  }
  if (tokensExit !== 0) {
    return { ok: false, detail: `twenty-ui's generated theme artifacts are stale (exit ${tokensExit}); regenerate with: npx nx generateTokens twenty-ui` };
  }
  // A compiler that accepts a deliberately mistyped file is a compiler that
  // measured nothing, however clean its verdict on the real code.
  if (canaryExit === 0) {
    return { ok: false, detail: 'tsgo ACCEPTED the deliberately mistyped canary file, so its exit 0 on the real sources proves nothing' };
  }
  return { ok: true, detail: `${summary.detail}; tsgo exit 0 and the canary rejected with ${canaryExit}` };
}

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function fail(message) {
  removeOwnResources({ keepImages: true });
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// Only ever what THIS run created: the container it named, the image tags its
// own builds wrote, and its own source tar. Nothing by pattern, by image or by
// age -- this daemon also holds the running stack and another gate's images --
// and every call shares one deadline so an unresponsive daemon cannot turn
// teardown into a hang.
function removeOwnResources({ keepImages = false } = {}) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  const bounded = (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: null, timedOut: true };
    const res = wsl(args, { timeout: remaining });
    return { ...res, timedOut: res.error?.code === 'ETIMEDOUT' || Boolean(res.signal) };
  };
  const describe = (res) => {
    if (res.timedOut) return `gave up after the teardown's ${CLEANUP_TIMEOUT_MS} ms deadline`;
    if (res.error) return `could not run (${res.error.code || res.error.message})`;
    return res.status === 0 ? 'ok' : `exited ${res.status}`;
  };

  const inspect = bounded(['docker', 'inspect', '--format', '{{.Id}}', CONTAINER_NAME]);
  if (inspect.timedOut) {
    console.error(`[INFO] could not ask Docker about this run's own container ${CONTAINER_NAME} (${describe(inspect)}): it may still be running`);
  } else if (inspect.status === 0) {
    const removed = bounded(['docker', 'rm', '-f', CONTAINER_NAME]);
    console.error(`[INFO] removed this run's own container ${CONTAINER_NAME} (${describe(removed)})`);
  }
  for (const image of [...ownImages].reverse()) {
    if (keepImages) {
      console.error(`[INFO] kept this run's own image tag ${image} for inspection; remove it with: docker image rm ${image}`);
      continue;
    }
    const removed = bounded(['docker', 'image', 'rm', image]);
    console.error(`[INFO] removed this run's own image tag ${image} (${describe(removed)})`);
  }
  const tar = bounded(['rm', '-f', SOURCE_TAR]);
  if (tar.status !== 0) console.error(`[INFO] this run's own source tar ${SOURCE_TAR} (${describe(tar)})`);
}

function git(args) {
  const res = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) fail(`git ${args.join(' ')} exited ${res.status}`);
  return res.stdout;
}

// The scoped program: twenty-front's own tsconfig (same compilerOptions, same
// strictness, same path aliases) with `include` narrowed to the files this
// track changes, their tests and -- through the compiler's own resolution --
// everything those import. The canary path is listed too: `include` is
// glob-based, so it is simply absent on the first run and picked up on the
// second, which is how one config serves both.
export function scopedTsconfig(canaryPath) {
  return {
    extends: './tsconfig.json',
    include: [...AMBIENT_PROGRAM_FILES, ...TYPECHECK_INCLUDE, ...SPECS, canaryPath],
  };
}

// Run inside the container: jest, then tsgo over the scoped program, then tsgo
// again with a deliberately mistyped canary file that it MUST reject. Every
// step prints its own exit code as a marker and the script always exits 0, so
// the container's status means "the three steps ran" and the verdict is read
// off the markers. The config is written from base64 rather than a heredoc:
// this whole script crosses wsl.exe as one argument.
function containerScript() {
  const canary = `src/aos-crm-canary-${RUN_ID}.ts`;
  const config = Buffer.from(JSON.stringify(scopedTsconfig(canary), null, 2)).toString('base64');
  return [
    'set -u',
    'cd /app/packages/twenty-front',
    `NODE_OPTIONS="--max-old-space-size=6144" npx jest --config jest.config.mjs --runInBand ${SPECS.join(' ')}; echo "${MARKERS.jest}=$?"`,
    `echo ${config} | base64 -d > ${SCOPED_TSCONFIG}`,
    `npx tsgo -p ${SCOPED_TSCONFIG}; echo "${MARKERS.tsgo}=$?"`,
    `printf 'export const aosCanary: number = "not a number";\\n' > ${canary}`,
    `npx tsgo -p ${SCOPED_TSCONFIG} > /tmp/canary.log 2>&1; echo "${MARKERS.canary}=$?"`,
    'tail -2 /tmp/canary.log',
    `rm -f ${canary} ${SCOPED_TSCONFIG}`,
    `npx oxfmt --check src/; echo "${MARKERS.lint}=$?"`,
    'cd /app',
    `npx tsx packages/twenty-ui/scripts/generateThemeTokens.ts --check; echo "${MARKERS.tokens}=$?"`,
    'exit 0',
  ].join('\n');
}

function run() {
  const linuxRoot = wsl(['wslpath', '-a', REPO_ROOT]);
  if (linuxRoot.status !== 0 || !linuxRoot.stdout.trim()) {
    fail(`could not reach WSL distro '${DISTRO}' to translate the repo path (status=${linuxRoot.status})`);
  }
  const root = linuxRoot.stdout.trim();

  for (const relative of WORKING_TREE_CONTEXT_PATHS) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`front-icons build input is missing from the checkout: ${relative}`);
    }
  }

  // The source context is `git archive HEAD`: committed content by definition.
  // Measuring HEAD while the working tree says something else would be a
  // measurement of code nobody is running, so an uncommitted change under these
  // inputs fails closed instead. The list is the context list itself, never a
  // copy.
  const trackedInputs = [
    ...ARCHIVE_PATHS,
    ...WORKING_TREE_CONTEXT_PATHS,
  ];
  const dirty = git(['status', '--porcelain', '--', ...trackedInputs])
    .split('\n').filter((l) => l.trim() !== '');
  if (dirty.length > 0) {
    fail(`${dirty.length} uncommitted change(s) under the inputs this gate measures (${dirty.slice(0, 3).map((l) => l.trim().slice(0, 60)).join('; ')}). This gate runs the committed tree; commit or stash them first.`);
  }

  console.log('[INFO] rebuilding the front-deps stage from the official Dockerfile (the Docker layer cache makes this seconds once the image build has warmed it)');
  const depsPaths = DEPS_CONTEXT_PATHS.map((p) => JSON.stringify(p)).join(' ');
  const depsBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; ` +
    `tar -cf - ${depsPaths} | ` +
    `docker build ${NO_ATTESTATION} --target front-deps -f packages/twenty-docker/twenty/Dockerfile -t ${DEPS_IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: DEPS_BUILD_TIMEOUT_MS });
  const depsBuildStatus = depsBuild.status;
  if (depsBuildStatus !== 0) fail(`docker build --target front-deps exited ${depsBuildStatus ?? 'unmeasured'}`);
  ownImages.push(DEPS_IMAGE);

  console.log('[INFO] building the source/library-build image from a clean git archive of HEAD');

  // `git archive` runs on the WINDOWS side, not inside the distro. CRM-019
  // measured why: in a worktree, `.git` is a FILE whose `gitdir:` line is a
  // Windows path (C:/.../.git/worktrees/<runId>), which Linux cannot resolve --
  // `git archive` there exits 128 with "not a git repository", so this gate
  // could only ever run from the main checkout. Windows git resolves it from
  // either place, and the tar it writes is handed to the distro by path.
  const archive = spawnSync('git', ['-C', REPO_ROOT, 'archive', '--format=tar',
    '-o', WINDOWS_SOURCE_TAR, 'HEAD', '--', ...ARCHIVE_PATHS,
  ], { encoding: 'utf8' });
  if (archive.status !== 0) {
    fail(`git archive exited ${archive.status ?? 'unmeasured'}: ${(archive.stderr || '').slice(-300)}`);
  }
  const translatedTar = wsl(['wslpath', '-a', WINDOWS_SOURCE_TAR]);
  if (translatedTar.status !== 0 || !translatedTar.stdout.trim()) {
    fail(`could not translate the source tar path into the distro (status=${translatedTar.status})`);
  }
  const linuxSourceTar = translatedTar.stdout.trim();

  const sourcesBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; rm -f ${SOURCE_TAR}; ` +
    // `dd` in 4 MiB chunks, not `cp`: the archive is ~113 MB and `cp` reads a
    // /mnt file in one large mapping, which this host failed with "cp: error
    // reading ...: Cannot allocate memory" on the second run of the afternoon
    // (measured 2026-10-30) while the same copy had worked an hour earlier.
    // An intermittent gate is a gate nobody believes.
    `dd if=${JSON.stringify(linuxSourceTar)} of=${SOURCE_TAR} bs=4M status=none; ` +
    `tar --append -f ${SOURCE_TAR} ${SOURCES_DOCKERFILE}; ` +
    `docker build ${NO_ATTESTATION} --build-arg DEPS_IMAGE=${DEPS_IMAGE} -f ${SOURCES_DOCKERFILE} ` +
    `-t ${SOURCES_IMAGE} - < ${SOURCE_TAR}; rm -f ${SOURCE_TAR}`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: SOURCES_BUILD_TIMEOUT_MS });
  rmSync(WINDOWS_SOURCE_TAR, { force: true });
  const sourcesBuildStatus = sourcesBuild.status;
  if (sourcesBuildStatus !== 0) {
    fail(`docker build -f ${SOURCES_DOCKERFILE} exited ${sourcesBuildStatus ?? 'unmeasured'}: the sources and library builds the tests need were not produced`);
  }
  ownImages.push(SOURCES_IMAGE);

  console.log(`[INFO] running ${SPECS.length} suites, the twenty-front typecheck, the formatter check and the theme-token drift check (container ${CONTAINER_NAME}, no network)`);
  const res = wsl(['docker', 'run', '--rm', '--name', CONTAINER_NAME, '--network', 'none', SOURCES_IMAGE,
    'sh', '-c', containerScript(),
  ], { timeout: RUN_TIMEOUT_MS });
  if (res.error?.code === 'ETIMEDOUT' || res.signal) {
    fail(`the frontend container exceeded its ${RUN_TIMEOUT_MS} ms budget and was torn down; nothing was measured`);
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = judgeFrontRun({ depsBuildStatus, sourcesBuildStatus, containerStatus: res.status, output });
  if (!verdict.ok) {
    const tail = output.split('\n').filter((l) => l.trim()).slice(-FAILURE_TAIL_LINES);
    console.error(tail.length ? tail.join('\n') : '(the container produced no output at all)');
    if (res.error) console.error(`spawn error: ${res.error.code || res.error.message}`);
    fail(`frontend icon flag: ${verdict.detail}`);
  }

  removeOwnResources();
  console.log(`[PASS] frontend icon flag measured by render: ${verdict.detail}`);
  console.log('Scope: the three flag consumers and the shared LINKS image identifier rendered with synthetic non-empty domains/links and the provider request intercepted, plus tsgo over twenty-front, with no network, over a git archive of this commit. This does NOT observe the running browser (see scripts/aos/test/crm-browser-e2e.test.mjs) and does not build the application image.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const measured = { depsBuildStatus: 0, sourcesBuildStatus: 0, containerStatus: 0 };
  const clean = [
    `Test Suites: ${EXPECTED_SUITES} passed, ${EXPECTED_SUITES} total`,
    'Tests:       20 passed, 20 total',
    `${MARKERS.jest}=0`,
    `${MARKERS.tsgo}=0`,
    `${MARKERS.canary}=2`,
    `${MARKERS.lint}=0`,
    `${MARKERS.tokens}=0`,
  ].join('\n');

  record('a clean run with both builds, the container, jest, tsgo and a rejected canary passes', () => {
    const r = judgeFrontRun({ ...measured, output: clean });
    assert(r.ok, r.detail);
  });
  record('a failing suite is rejected', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`Test Suites: ${EXPECTED_SUITES} passed, ${EXPECTED_SUITES} total`, `Test Suites: 1 failed, ${EXPECTED_SUITES - 1} passed, ${EXPECTED_SUITES} total`) });
    assert(!r.ok, 'expected a failing suite to be rejected');
  });
  record('stale generated theme artifacts fail even with everything else green', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`${MARKERS.tokens}=0`, `${MARKERS.tokens}=1`) });
    assert(!r.ok, 'expected a stale theme to fail');
    assert(/generated theme artifacts are stale/.test(r.detail), r.detail);
  });
  record('unformatted sources fail even with jest and tsgo green', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`${MARKERS.lint}=0`, `${MARKERS.lint}=1`) });
    assert(!r.ok, 'expected a non-zero oxfmt exit to fail');
    assert(/oxfmt reported unformatted sources/.test(r.detail), r.detail);
  });
  record('a run that matched fewer suites than this gate claims is rejected, not read as green', () => {
    for (const summary of ['Test Suites: 0 total\nTests:       0 total', `Test Suites: ${EXPECTED_SUITES - 1} passed, ${EXPECTED_SUITES - 1} total\nTests:       9 passed, 9 total`]) {
      const r = judgeFrontRun({ ...measured, output: `${summary}\n${MARKERS.jest}=0\n${MARKERS.tsgo}=0\n${MARKERS.canary}=2\n${MARKERS.lint}=0` });
      assert(!r.ok, `expected "${summary.split('\n')[0]}" to be rejected`);
    }
  });
  record('a FAILED front-deps build fails before anything the container printed is believed', () => {
    for (const status of [1, 137, null, undefined]) {
      const r = judgeFrontRun({ ...measured, depsBuildStatus: status, output: clean });
      assert(!r.ok, `expected deps build status ${status} to fail`);
      assert(/front-deps stage exited/.test(r.detail), `the detail does not name the deps stage: ${r.detail}`);
    }
  });
  record('a FAILED source/library-build image fails, however green the markers look', () => {
    for (const status of [1, 137, null]) {
      const r = judgeFrontRun({ ...measured, sourcesBuildStatus: status, output: clean });
      assert(!r.ok, `expected sources build status ${status} to fail`);
      assert(/source\/library-build image exited/.test(r.detail), `the detail does not name the source image: ${r.detail}`);
    }
  });
  record('a container the runtime killed is not a verdict (exit 124/137 with a clean tail)', () => {
    for (const status of [124, 137, 1, null]) {
      const r = judgeFrontRun({ ...measured, containerStatus: status, output: clean });
      assert(!r.ok, `expected container status ${status} to fail`);
      assert(/container exited/.test(r.detail), `the detail does not name the container: ${r.detail}`);
    }
  });
  record('a missing marker is a failure, not an assumed success', () => {
    for (const marker of Object.values(MARKERS)) {
      const r = judgeFrontRun({ ...measured, output: clean.split('\n').filter((l) => !l.startsWith(marker)).join('\n') });
      assert(!r.ok, `expected a run without ${marker} to fail`);
    }
  });
  record('tsgo rejecting the real sources fails even with every suite green', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`${MARKERS.tsgo}=0`, `${MARKERS.tsgo}=1`) });
    assert(!r.ok, 'expected a non-zero tsgo exit to fail');
    assert(/tsgo rejected twenty-front/.test(r.detail), r.detail);
  });
  record('a canary tsgo ACCEPTED fails: a compiler that passes broken code measured nothing', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`${MARKERS.canary}=2`, `${MARKERS.canary}=0`) });
    assert(!r.ok, 'expected an accepted canary to fail');
    assert(/ACCEPTED the deliberately mistyped canary/.test(r.detail), r.detail);
  });
  record('jest exiting non-zero fails even when its own summary reads clean', () => {
    const r = judgeFrontRun({ ...measured, output: clean.replace(`${MARKERS.jest}=0`, `${MARKERS.jest}=1`) });
    assert(!r.ok, 'expected a non-zero jest exit to fail');
  });

  record('every suite this gate claims to run exists in the checkout', () => {
    assert(SPECS.length >= 6, `expected at least six suites, got ${SPECS.length}`);
    for (const spec of SPECS) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])',
        resolve(REPO_ROOT, 'packages', 'twenty-front', spec)]);
    }
  });
  record('every front-deps build input exists, so the stage is rebuilt from a complete context', () => {
    for (const relative of DEPS_CONTEXT_PATHS) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, relative)]);
    }
  });
  record('the build context declares every path the official front-deps stage COPYs', () => {
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'packages/twenty-docker/twenty/Dockerfile'), 'utf8');
    const stage = dockerfile.split(/^FROM .* AS front-deps$/m)[1].split(/^FROM /m)[0];
    const copied = [...stage.matchAll(/^COPY\s+(.+?)\s+\/app/gm)]
      .flatMap((m) => m[1].trim().split(/\s+/))
      .map((p) => p.replace(/^\.\//, ''));
    assert(copied.length > 0, 'parsed no COPY source out of the front-deps stage');
    const missing = copied.filter((p) => !DEPS_CONTEXT_PATHS.includes(p));
    assert(missing.length === 0, `the stage COPYs path(s) absent from DEPS_CONTEXT_PATHS: ${missing.join(', ')}`);
  });
  record('every file entering a build context from the working tree is covered by the uncommitted-change check', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(WORKING_TREE_CONTEXT_PATHS.includes(SOURCES_DOCKERFILE),
      `${SOURCES_DOCKERFILE} enters the build context from the working tree but is not dirty-checked`);
    assert(/const trackedInputs = \[\s*\.\.\.ARCHIVE_PATHS,\s*\.\.\.WORKING_TREE_CONTEXT_PATHS,\s*\]/.test(source),
      'the uncommitted-change check no longer derives its inputs from the archive and working-tree context lists');
    assert(source.includes("'-o', WINDOWS_SOURCE_TAR, 'HEAD', '--', ...ARCHIVE_PATHS,"),
      'the git archive no longer takes its paths from the same list the dirty check covers');
    assert(/spawnSync\('git', \['-C', REPO_ROOT, 'archive'/.test(source),
      'the git archive runs inside the distro again, where a worktree .git file points at an unresolvable Windows path');
    const appended = [...source.matchAll(/tar --append -f \$\{SOURCE_TAR\} ([^;\s]+)/g)].map((m) => m[1]);
    assert(appended.length === 1 && appended[0] === '${SOURCES_DOCKERFILE}',
      `a working-tree path is appended to the source context outside the checked list: ${appended.join(', ')}`);
  });
  record('the source image derives from the OFFICIAL front-deps stage, bypasses the Nx cache and copies twenty-front LAST', () => {
    const dockerfilePath = resolve(REPO_ROOT, SOURCES_DOCKERFILE);
    const sources = readFileSync(dockerfilePath, 'utf8');
    const instructions = sources.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert(/^ARG DEPS_IMAGE$/m.test(instructions) && /^FROM \$\{DEPS_IMAGE\}$/m.test(instructions),
      'the source image no longer derives from the image this wrapper builds from the official Dockerfile');
    const wrapper = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--target front-deps -f packages\/twenty-docker\/twenty\/Dockerfile/.test(wrapper),
      "the dependency image is no longer the official Dockerfile's own front-deps stage");
    assert(/--skip-nx-cache/.test(instructions), 'the library build no longer bypasses the Nx cache');
    // The ordering is what keeps a second run (after fixing the components)
    // from paying for the library build again.
    const frontCopy = instructions.indexOf('COPY packages/twenty-front /app');
    const libraryBuild = instructions.indexOf('nx run-many');
    assert(libraryBuild > 0 && frontCopy > libraryBuild,
      'twenty-front is no longer copied after the library build, so every frontend edit re-runs it');
    for (const pkg of FRONT_SOURCE_PACKAGES) {
      assert(instructions.includes(`COPY packages/${pkg} /app/packages/${pkg}`), `packages/${pkg} is archived but never copied into the image`);
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, 'packages', pkg)]);
    }
  });
  record('both builds disable the attestation that would make a cached rebuild non-reproducible', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(NO_ATTESTATION === '--provenance=false', `the attestation opt-out changed shape: ${NO_ATTESTATION}`);
    assert([...source.matchAll(/docker build \$\{NO_ATTESTATION\}/g)].length === 2,
      'expected both docker builds to pass the attestation opt-out');
  });
  record('the container is isolated from the network and torn down only by its own name', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/'--network', 'none'/.test(source), 'the container is no longer isolated from the network');
    assert(/'docker', 'rm', '-f', CONTAINER_NAME/.test(source), "cleanup no longer targets this run's own container by name");
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\(|--filter)/.test(source), 'cleanup matches resources by pattern instead of by name');
    const bindFlag = `'${['-', 'v'].join('')}',`;
    assert(!source.includes(bindFlag), 'the container takes a bind mount again instead of reading sources from its own layer');
  });
  record('two simultaneous runs collide on nothing', () => {
    const a = runResourceNames(newRunId());
    const b = runResourceNames(newRunId());
    const kinds = Object.keys(a);
    assert(kinds.length === 5, `expected five temporary resources, got ${kinds.join(', ')}`);
    for (const kind of kinds) assert(a[kind] !== b[kind], `two runs on one distro would share ${kind}: ${a[kind]}`);
    for (const [kind, live] of [['sourceTar', SOURCE_TAR], ['windowsSourceTar', WINDOWS_SOURCE_TAR], ['depsImage', DEPS_IMAGE], ['sourcesImage', SOURCES_IMAGE], ['containerName', CONTAINER_NAME]]) {
      assert(live === runResourceNames(RUN_ID)[kind], `${kind} is not derived from this run's id: ${live}`);
      assert(live.includes(RUN_ID), `${kind} ('${live}') does not carry this run's identity`);
    }
    // The canary file is written INSIDE the container, but it is named after
    // the run for the same reason: a fixed name would be a shared resource.
    assert(containerScript().includes(`aos-crm-canary-${RUN_ID}`), 'the typecheck canary is no longer named after this run');
  });
  record('the three guarded components read the official flag, and the initial state is fail-closed', () => {
    const front = resolve(REPO_ROOT, 'packages', 'twenty-front');
    for (const relative of GUARDED_COMPONENTS) {
      const source = readFileSync(resolve(front, relative), 'utf8');
      assert(/allowRequestsToTwentyIconsState/.test(source),
        `${relative} does not read allowRequestsToTwentyIconsState: it would request icons with the flag off`);
    }
    const state = readFileSync(resolve(front, FLAG_STATE_FILE), 'utf8');
    assert(/defaultValue:\s*false/.test(state),
      `${FLAG_STATE_FILE} no longer defaults to false: the first render would request icons before /client-config answers`);
  });
  record('the typechecked program covers the whole project, and every file this gate names resolves inside it', () => {
    const config = scopedTsconfig('src/aos-crm-canary-x.ts');
    assert(config.extends === './tsconfig.json',
      "the scoped program no longer extends twenty-front's own tsconfig, so it is not the project's own strictness");
    // CRM-019: a file list would drift from a track that touches sixty files,
    // so the program is the project. A narrowing here has to fail.
    assert(config.include.includes('src/**/*'),
      'the typechecked program is narrowed again: a changed file outside the list would go unchecked');
    const front = resolve(REPO_ROOT, 'packages', 'twenty-front');
    const covered = new Set(
      config.include
        .flatMap((entry) => globSync(entry, { cwd: front }))
        .map((relative) => relative.split('\\').join('/')),
    );
    for (const relative of [FLAG_STATE_FILE, ...GUARDED_COMPONENTS, ...SPECS]) {
      assert(covered.has(relative), `${relative} is not inside the typechecked program`);
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])',
        resolve(REPO_ROOT, 'packages', 'twenty-front', relative)]);
    }
    assert(config.include.includes('src/aos-crm-canary-x.ts'),
      'the canary is not in the typechecked program, so the compiler would never be asked to reject it');
  });
  record("the scoped program keeps the ambient declarations and jest setup twenty-front's own program carries", () => {
    const front = resolve(REPO_ROOT, 'packages', 'twenty-front');
    const config = scopedTsconfig('src/aos-crm-canary-x.ts');
    const project = JSON.parse(readFileSync(resolve(front, 'tsconfig.json'), 'utf8'));
    for (const entry of AMBIENT_PROGRAM_FILES) {
      assert(config.include.includes(entry), `${entry} is not in the typechecked program`);
      // A subset of the project's own program, never an addition to it: if
      // upstream drops one of these, this fails here instead of quietly
      // typechecking something twenty-front does not.
      assert(project.include.includes(entry),
        `${entry} is no longer in twenty-front's own tsconfig include, so the scoped program is not a subset of the project's`);
    }
    // Asserted against the files the entries actually resolve to in this
    // checkout, not against the list itself: dropping an entry (or upstream
    // moving what it carried) has to fail HERE, and a list checked against
    // itself would pass whatever is in it.
    const carried = AMBIENT_PROGRAM_FILES
      .flatMap((entry) => globSync(entry, { cwd: front }))
      .map((relative) => readFileSync(resolve(front, relative), 'utf8'));
    assert(carried.some((source) => /interface Window\b[\s\S]*?_env_/.test(source)),
      'the typechecked program no longer carries the ambient declaration of Window._env_, which src/config/index.ts reads: tsgo would reject untouched upstream code');
    assert(carried.some((source) => /@testing-library\/jest-dom/.test(source)),
      'the typechecked program no longer carries the import that registers the jest-dom matcher types, so the suites toBeInTheDocument calls would be untyped');
  });
  record('the sources image carries the jest preset and restores the declarations twenty-front relies on', () => {
    const instructions = readFileSync(resolve(REPO_ROOT, SOURCES_DOCKERFILE), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert(/COPY jest\.preset\.js \/app\/jest\.preset\.js/.test(instructions),
      'the workspace-root jest preset is no longer copied in; jest would fail with "Preset ../../jest.preset.js not found"');
    assert(instructions.includes('COPY .oxfmtrc.jsonc /app/.oxfmtrc.jsonc'),
      "the formatter config is no longer copied in; the theme-token drift check would format with oxfmt's defaults and report every generated file as stale");
    assert(ARCHIVE_PATHS.includes('.oxfmtrc.jsonc'),
      'the formatter config is copied in the Dockerfile but not archived into the context');
    assert(ARCHIVE_PATHS.includes('jest.preset.js'), 'the jest preset is copied in the Dockerfile but not archived into the context');
    assert(ARCHIVE_PATHS.includes('packages/twenty-server/package.json'),
      "twenty-server's manifest is read for the @types specs but not archived into the context");
    // Read from twenty-server's manifest, never written out here: a hand-kept
    // copy would drift from the specs the full install hoists.
    assert(/twenty-server-package\.json'\)\.devDependencies/.test(instructions),
      'the restored @types specs are no longer read out of twenty-server/package.json');
    assert(!/npm install[^\n]*--prefix \/app\b/.test(instructions),
      'npm installs against /app again, which reconciles the whole yarn-installed tree');
    const server = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/twenty-server/package.json'), 'utf8'));
    for (const name of ['@types/lodash.groupby', '@types/lodash.isempty', '@types/lodash.omit', '@types/lodash.uniqby', '@types/pluralize']) {
      assert(server.devDependencies[name], `twenty-server no longer declares ${name}, so the sources image build would fail`);
    }
  });
  record('the local profile pins the official flag off', () => {
    const profile = readFileSync(resolve(REPO_ROOT, 'deploy/local/privacy.env'), 'utf8');
    assert(/^ALLOW_REQUESTS_TO_TWENTY_ICONS=false$/m.test(profile),
      'deploy/local/privacy.env no longer pins ALLOW_REQUESTS_TO_TWENTY_ICONS=false');
  });
  record('the run has its own deadlines, and all of them plus the teardown fit inside the gate budget', () => {
    const verify = JSON.parse(readFileSync(resolveGateFile(), 'utf8'));
    const budget = verify.timeoutsMs['verify-front-icons.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    assert(verify.commands.includes('node scripts/aos/verify-front-icons.mjs'), 'this command is not in the gate');
    assert(verify.commands.includes('node scripts/aos/verify-front-icons.mjs --self-test'), 'this self-test is not in the gate');
    const worstCase = DEPS_BUILD_TIMEOUT_MS + SOURCES_BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS + CLEANUP_TIMEOUT_MS;
    assert(worstCase < budget, `the worst case (${worstCase} ms) must stay under the gate budget (${budget} ms)`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
