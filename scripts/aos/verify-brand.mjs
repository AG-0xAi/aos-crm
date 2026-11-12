#!/usr/bin/env node
// CRM-019 (R4): the brand guard. Fails when a user-visible string says
// "Twenty", or when any shipped code names a Twenty-hosted URL, outside an
// explicit allowlist where every entry carries a reason.
//
// What this exists to measure. CRM-019 renamed 40 translatable messages, the
// document title, the e-mail templates and every link that left for a Twenty
// host. None of that stays renamed on its own: the next upstream merge brings
// new `t`...`` strings, and a single "Twenty" in a Section.Header is invisible
// in a 900-file diff. This reads the source the build actually ships and makes
// that a red gate instead of a code review someone has to remember to do.
//
// It is a STATIC scanner: it reads files, never builds, never starts anything,
// needs no Docker and no network. It therefore proves nothing about the
// rendered page -- that is the unit suites inside
// scripts/aos/verify-front-icons.mjs and the browser path in
// scripts/aos/test/crm-brand-e2e.test.mjs.
//
//   node scripts/aos/verify-brand.mjs
//   node scripts/aos/verify-brand.mjs --self-test
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, posix, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The bus is one `.aos/` for the whole project and it is gitignored, so a
// worktree under `<main>/.aos/worktrees/<runId>` has no `.aos/verify.json` of
// its own. `git rev-parse --git-common-dir` points at the main checkout's
// `.git` from either place, which is how the gate file is found from both.
export function resolveGateFile(root = REPO_ROOT) {
  const local = resolve(root, '.aos/verify.json');

  if (existsSync(local)) return local;

  const commonGitDir = execFileSync(
    'git',
    ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  const shared = resolve(commonGitDir, '..', '.aos/verify.json');

  if (existsSync(shared)) return shared;

  throw new Error(
    `no .aos/verify.json next to ${root} nor beside the shared git dir ${commonGitDir}`,
  );
}

// The packages whose code reaches a user: the app, its design system, the
// isomorphic layer they share, and the transactional e-mails. twenty-docs,
// twenty-website and twenty-zapier are upstream's own properties and are not
// deployed by this project.
export const SCANNED_GLOBS = [
  'packages/twenty-front/src/**/*.{ts,tsx}',
  'packages/twenty-front/index.html',
  'packages/twenty-ui/src/**/*.{ts,tsx}',
  'packages/twenty-shared/src/**/*.ts',
  'packages/twenty-emails/src/**/*.{ts,tsx}',
  'packages/twenty-server/src/**/*.ts',
];

// Test fixtures, mocks, stories and generated catalogues are not shipped text.
// Lingui catalogues in particular are regenerated from the source strings, so
// scanning them would report the same message twice -- once where it is
// written, once where it is translated -- and the first report is the useful
// one.
export const SKIPPED_PATH_FRAGMENTS = [
  '/locales/',
  '/generated/',
  '/generated-metadata/',
  '/generated-admin/',
  '/__tests__/',
  '/__mocks__/',
  '/__stories__/',
  '/__snapshots__/',
  '/testing/',
  '/test-utils/',
  '.spec.ts',
  '.test.ts',
  '.test.tsx',
  '.stories.tsx',
];

// A Twenty-owned host in any shipped string. Deliberately wider than
// twenty.com: the icon provider was twenty-icons.com, telemetry is
// twenty-telemetry.com and the placeholder images were on twentyhq.github.io.
export const TWENTY_HOST_PATTERN =
  /https?:\/\/[a-z0-9.-]*\btwenty(hq|-[a-z]+)?\b[a-z0-9.-]*\.[a-z]{2,}/gi;

// The same host, with no "https://" in front. CRM-037 found exactly this
// shape as EXAMPLE DATA with no scheme at all: 'tim@twenty.com' in a composite
// field preview, 'twenty.com' as a Links field sample, a prefilled workflow's
// sample domain value. None of those carry a protocol, so TWENTY_HOST_PATTERN
// above never sees them.
export const TWENTY_BARE_DOMAIN_PATTERN =
  /\b(?:[a-z0-9-]+\.)*twenty(hq)?\.(?:com|io|dev|co)\b/gi;

// The product name as a WORD, so TwentyOrm, isTwentyStandardApplication and
// twenty-shared do not trip it -- those are code identifiers and package
// names, which the contract says keep their upstream names.
export const TWENTY_WORD_PATTERN = /(^|[^A-Za-z0-9_-])Twenty([^A-Za-z0-9_-]|$)/;

// A reference to a FILE that carries Twenty's own mark. Neither pattern above
// sees these: `twenty-logo.svg` is a hyphenated identifier, and
// `/images/icons/android/android-launchericon-192-192.png` names no host and no
// word -- yet it was the default logo on every sign-in screen until CRM-019
// fix1. The founder saw exactly this on 30/10.
export const TWENTY_ASSET_PATTERNS = [
  // The mark itself, in any raster or vector form.
  /\b[a-z0-9._-]*twenty[a-z0-9._-]*\.(?:svg|png|jpe?g|webp|ico|gif)\b/i,
  // The PWA icon set: every size of Twenty's tile, under its own directories.
  /\bimages\/icons\/(?:android|ios|windows11)\//i,
  /\bandroid-launchericon\b/i,
  /\bSquare\d+x\d+Logo\b/,
  /\b(?:LargeTile|SmallTile|SplashScreen|StoreLogo|Wide\d+x\d+Logo)\.scale-/,
  // Twenty-brand ornaments: the blue halftone OAuth band and the violet
  // halftone of the onboarding welcome.
  /\boauth-modal-header\b/i,
  /\bwelcome-halftone\b/i,
];

// Every exception, with the reason it is one. No wildcards: an entry names one
// file and the exact text it excuses, so an entry that stops matching is a
// failure (see the self-test) rather than cover for the next string that
// creeps in.
export const ALLOWLIST = [
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/constants/dpa-template.constant.ts',
    match: 'Twenty',
    reason:
      "Twenty Inc.'s own Data Processing Agreement. Rewriting a legal instrument to say Betty would assert a contract that does not exist; the page is unreachable from the navigation. Founder decision before any launch with billing on.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/constants/dpa-template-version.constant.ts',
    match: 'Twenty Data Processing Agreement (DPA)',
    reason: "The title of Twenty Inc.'s own DPA template. Same reason as the template itself.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/config/dpa-region-config.constant.ts',
    match: 'Twenty.com',
    reason:
      "Twenty Inc.'s legal entities (Twenty.com PBC and Twenty.com SAS) as the DPA's processor. A legal entity name is a fact, not branding.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/config/dpa-region-config.constant.ts',
    match: 'privacy@twenty.com',
    reason:
      "Twenty Inc.'s own Data Protection Officer contact address in its legal DPA. Same reason as the legal entity names above.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/constants/dpa-template.constant.ts',
    match: 'privacy@twenty.com',
    reason:
      "Twenty Inc.'s own DPO contact address, repeated at several points of its legal Data Processing Agreement. Same reason as the template itself.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/constants/dpa-template.constant.ts',
    match: 'https://trust.twenty.com',
    reason:
      "Twenty Inc.'s own Trust Center, where its legal DPA tells a customer to find the current Sub-Processor list. Same reason as the template itself.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/services/dpa.service.ts',
    match: 'Twenty does not host or process Customer Personal Data',
    reason:
      'States correctly that Twenty Inc. is not the processor for a self-hosted deployment. Renaming it would reverse its meaning.',
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/utils/resolve-dpa.util.ts',
    match: 'pre-signed by Twenty',
    reason:
      "Names who pre-signed Twenty Inc.'s template. Betty signs nothing here; claiming otherwise would forge a signature block.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/dpa/utils/resolve-dpa.util.ts',
    match: 'This Twenty instance is self-hosted',
    reason:
      'The invalid-agreement banner, stating correctly that Twenty Inc. is not the processor of a self-hosted deployment.',
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts',
    match: 'The Processor entity (Twenty.com PBC)',
    reason:
      'Describes which legal entity the DPA names per region. Same reason as the DPA module.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/constants/person-data-seeds.constant.ts',
    match: 'twenty',
    reason:
      'Development seed data (nx database:seed), never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts',
    match: 'twenty',
    reason: 'Development seed workspaces, never created by a real sign-up.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/agent-chat-seeds.constant.ts',
    match: 'Twenty field',
    reason: 'Development seed chat transcript, never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/utils/get-page-layout-widget-data-seeds.util.ts',
    match: 'Twenty Star History',
    reason: 'Development seed dashboard widget, never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/utils/seed-agents.util.ts',
    match: 'Twenty',
    reason: 'Development seed agent transcript, never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/services/dev-seeder-agent-chat-pending-input.workspace-service.ts',
    match: 'Twenty',
    reason:
      'Development seed chat transcript, never installed by a real workspace. The whole file is seed text, so the match is the bare word on purpose.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/services/dev-seeder-workflow-pending-input.workspace-service.ts',
    match: 'Twenty subscription renews',
    reason: 'Development seed workflow draft, never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/services/dev-seeder-workflow-pending-input.workspace-service.ts',
    match: 'Your Twenty renewal on October 31',
    reason: 'Development seed workflow draft, never installed by a real workspace.',
  },
  {
    file: 'packages/twenty-server/src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1792741864752-backfill-standard-application-default-role.command.ts',
    match: 'Twenty standard application',
    reason:
      "An already-published upgrade command. The upstream convention (docs/aos/upstream/CLAUDE.md) is never to rewrite committed command logic, and the string is the command's own description in server logs.",
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/workspace-migration/services/workspace-migration-flat-entity-maps.service.ts',
    match: 'Twenty standard application not found in workspace',
    reason:
      'Internal invariant failure naming the twenty-standard-application entity, which is a code identifier the contract keeps. Not shown to a user.',
  },
  {
    file: 'packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/twenty-cli-application-registration.constant.ts',
    match: 'Twenty CLI',
    reason:
      "The registered name and description of the real `twenty` npm CLI's OAuth application. Renaming it would stop matching the tool users actually install.",
  },
  {
    file: 'packages/twenty-ui/src/icon/constants/TwentyIconDictionary.ts',
    match: 'figma.com/design/xt8O9mFeLl46C5InWwoMrN/Twenty',
    reason:
      "The upstream Figma file this icon dictionary is generated from, kept as provenance. Figma-hosted, not Twenty-hosted, and it is not rendered anywhere.",
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/telemetry/telemetry.service.ts',
    match: 'https://twenty-telemetry.com/api/v2',
    reason:
      'Upstream telemetry endpoint. CRM-003 pinned TELEMETRY_ENABLED=false and verify-privacy.mjs asserts publish() returns before it builds a client, so this string is never dialled. Kept as the single place a reader finds the destination.',
  },
  {
    file: 'packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts',
    match: 'https://twenty.com/api/enterprise',
    reason:
      'Default ENTERPRISE_API_URL. CRM-003 verified neither refreshValidityToken nor reportSeats fetches without ENTERPRISE_KEY, which this deployment does not set.',
  },
  {
    file: 'packages/twenty-server/src/engine/api/mcp/constants/mcp-excluded-tool-names.constant.ts',
    match: 'https://docs.twenty.com/mcp',
    reason:
      "A comment recording WHY search_help_center is excluded from MCP. CRM-019 also removed the request itself from the tool, so this names a destination the code no longer has.",
  },
  {
    file: 'packages/twenty-shared/src/utils/image/getLogoUrlFromDomainName.ts',
    match: 'https://twenty-icons.com/<domain>',
    reason:
      'A comment recording the provider URL this function used to build, so the next reader knows what returning undefined is protecting.',
  },
  {
    file: 'packages/twenty-emails/src/components/Footer.tsx',
    match: "upstream footer linked Twenty's website",
    reason: 'A comment recording what the footer used to link.',
  },
  {
    file: 'packages/twenty-front/src/modules/settings/billing/hooks/useStripeAppearance.ts',
    match: 'Twenty theme',
    reason: 'A comment about the theme token format, not user-visible text.',
  },
  {
    file: 'packages/twenty-front/src/modules/settings/mcp/utils/buildMcpSetupCategories.tsx',
    match: "Twenty's own hosted ChatGPT app",
    reason: 'A comment recording the card CRM-019 removed.',
  },
  {
    file: 'packages/twenty-front/src/pages/settings/applications/components/SettingsClaimApplicationSection.tsx',
    match: 'twenty-app',
    reason:
      'The real npm keyword an app must publish under, and the matching example package name. Changing it would print an instruction that does not work.',
  },
  {
    file: 'packages/twenty-front/src/modules/settings/developers/constants/TwentyCliCreateAppCommands.ts',
    match: 'npx twenty@latest',
    reason:
      'The real npm package name of the app CLI. Commands have to be runnable; the tab that prints them is server-admin only (R2).',
  },
  {
    file: 'packages/twenty-front/src/modules/settings/developers/constants/TwentyCliLoginCommand.ts',
    match: 'npx twenty@latest',
    reason: 'Same CLI package name, same server-admin-only tab.',
  },
  {
    file: 'packages/twenty-front/src/pages/settings/developers/tabs/SettingsDevelopersCliTab.tsx',
    match: 'npx twenty@latest',
    reason: 'Same CLI package name, same server-admin-only tab.',
  },
  {
    file: 'packages/twenty-front/src/pages/settings/about/SettingsAbout.tsx',
    match: 'Its CRM is built on Twenty',
    reason:
      'CRM-026: the AGPL open-source credit, naming the upstream project this fork is built from. The founder asked for this attribution explicitly, on a page only a signed-in user reaches.',
  },
  {
    file: 'packages/twenty-front/src/modules/settings/admin-panel/components/SettingsAdminVersionContainer.tsx',
    match: 'Twenty v',
    reason:
      'CRM-032: the upstream version this fork is based on, shown as plain text with no link in the server-admin-only Admin Panel (Based on Twenty v2.51.0).',
  },
];

export function isScannedPath(relativePath) {
  const normalized = `/${relativePath.split(sep).join('/')}`;

  return !SKIPPED_PATH_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

// Everything a reader of the running app can end up looking at: the text of a
// translatable message, a JSX text node, and any string literal that is not a
// module specifier. Import paths are excluded by construction (the contract
// keeps package names), and so is a `//` or `/* */` comment, which no user
// sees -- comments that name an old destination on purpose are the reason the
// allowlist exists for the few that remain.
export function extractUserFacingStrings(source, { isHtml = false } = {}) {
  if (isHtml) {
    return [
      ...[...source.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]),
      ...[...source.matchAll(/content="([^"]*)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/>([^<>{}]*[A-Za-z]{3}[^<>{}]*)</g)].map((m) =>
        m[1].trim(),
      ),
    ].filter((value) => value !== '');
  }

  const strings = [];

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();

    // Module specifiers and comment lines are not user-visible text.
    if (
      line.startsWith('import ') ||
      line.startsWith('export * from') ||
      line.startsWith('export {') ||
      line.startsWith('export type {') ||
      line.startsWith('//') ||
      line.startsWith('*') ||
      line.startsWith('/*')
    ) {
      continue;
    }

    // from '...' on its own line (multi-line import tails)
    if (/^}?\s*from\s+['"]/.test(line)) continue;

    for (const match of line.matchAll(/'((?:[^'\\]|\\.)*)'/g)) strings.push(match[1]);
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) strings.push(match[1]);
    for (const match of line.matchAll(/`((?:[^`\\]|\\.)*)`/g)) strings.push(match[1]);

    // JSX text between tags on the same line, e.g. <Trans>By using X</Trans>
    for (const match of line.matchAll(/>([^<>{}]*[A-Za-z]{3}[^<>{}]*)</g)) {
      strings.push(match[1].trim());
    }
  }

  return strings.filter((value) => value !== '');
}

export function findViolations({ relativePath, source }) {
  const isHtml = relativePath.endsWith('.html');
  const violations = [];

  for (const value of extractUserFacingStrings(source, { isHtml })) {
    // A path or a module specifier that survived the line filters.
    if (/^(\.\.?\/|@\/|~\/|src\/|packages\/|twenty-[a-z-]+\/)/.test(value)) {
      continue;
    }

    for (const url of value.match(TWENTY_HOST_PATTERN) ?? []) {
      violations.push({ kind: 'twenty-host', text: url, inside: value });
    }

    for (const domain of value.match(TWENTY_BARE_DOMAIN_PATTERN) ?? []) {
      violations.push({ kind: 'twenty-host', text: domain, inside: value });
    }

    if (TWENTY_WORD_PATTERN.test(` ${value} `)) {
      violations.push({ kind: 'twenty-name', text: 'Twenty', inside: value });
    }

    for (const pattern of TWENTY_ASSET_PATTERNS) {
      const asset = pattern.exec(value);

      if (asset !== null) {
        violations.push({ kind: 'twenty-asset', text: asset[0], inside: value });
      }
    }
  }

  return violations.map((violation) => ({ ...violation, file: relativePath }));
}

export function isAllowed(violation, allowlist = ALLOWLIST) {
  return allowlist.some(
    (entry) =>
      entry.file === violation.file &&
      (violation.inside.includes(entry.match) ||
        violation.text.includes(entry.match)),
  );
}

export function scanRepository({ root = REPO_ROOT, allowlist = ALLOWLIST } = {}) {
  const files = SCANNED_GLOBS.flatMap((pattern) =>
    globSync(pattern, { cwd: root }),
  )
    .map((p) => p.split(sep).join(posix.sep))
    .filter(isScannedPath)
    .sort();

  const violations = [];

  for (const relativePath of files) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');

    for (const violation of findViolations({ relativePath, source })) {
      if (!isAllowed(violation, allowlist)) violations.push(violation);
    }
  }

  return { filesScanned: files.length, violations };
}

// The theme is the other half of "Betty, not Twenty": a renamed string on an
// Inter-and-blue page is still not the brand. These are the GENERATED
// artifacts (npx nx generateTokens twenty-ui), so this also catches a token
// source edited without regenerating -- the thing a reader cannot see in a
// diff. Whether they are in sync with the source is measured inside the gate
// image, where tsx can run the generator (`--check`).
export const THEME_ARTIFACTS = [
  'packages/twenty-ui/src/theme/theme-light.css',
  'packages/twenty-ui/src/theme/theme-dark.css',
];

export function checkThemeIdentity(root = REPO_ROOT) {
  const failures = [];
  // Light and dark both: the inverse variant is as much the brand as the
  // primary one (manual 3.1).
  const required = [
    ['--t-font-family:', "'Source Sans 3'"],
    ['--t-font-family-display:', "'Fraunces'"],
    ['--t-font-color-primary:', ['#35362e', '#f9f5ec']],
    ['--t-background-primary:', ['#fffdf9', '#2a2b24']],
    ['--t-accent-primary:', ['#96442d', '#c87452']],
  ];

  for (const [index, relative] of THEME_ARTIFACTS.entries()) {
    const source = readFileSync(resolve(root, relative), 'utf8');

    if (/\bInter\b/.test(source)) {
      failures.push(`${relative} still names Inter as a font family`);
    }

    for (const [property, expected] of required) {
      const line = source
        .split('\n')
        .find((candidate) => candidate.includes(property));
      const wanted = Array.isArray(expected) ? expected[index] : expected;

      if (!line) {
        failures.push(`${relative} declares no ${property}`);
        continue;
      }

      if (!line.toLowerCase().includes(wanted.toLowerCase())) {
        failures.push(
          `${relative} ${property} is ${line.trim()}, expected it to carry ${wanted}`,
        );
      }
    }
  }

  return failures;
}

// The direct child element names of a JSX fragment, ignoring anything nested
// inside them. A tiny depth walker rather than a regex: `<Row><Column><Link/>
// </Column></Row>` must read as one child, not three.
export function directChildTagNames(body) {
  const names = [];
  let depth = 0;

  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w.]*)\b[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;

    if (closing === '/') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) names.push(name);
    if (selfClosing !== '/') depth += 1;
  }

  return names;
}

// react-email's <Row> renders `<table><tbody><tr>`, so every direct child has
// to be a <Column> -- a `<td>`. Anything else is a non-`<td>` inside a `<tr>`:
// strict clients (Outlook) mis-render or drop it, and the footer this caught
// ships in almost every template. Every other <Row> in the package already
// wraps; this makes that a gate instead of a convention.
export function findEmailRowFailures({ relativePath, source }) {
  const failures = [];

  for (const row of source.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/g)) {
    // A Fragment emits no element, so a Column inside one still renders the
    // <td>. `<>` shorthand is already invisible to the walker.
    const body = row[1].replace(/<\/?(?:React\.)?Fragment\b[^>]*>/g, '');
    const offenders = directChildTagNames(body).filter(
      (name) => name !== 'Column',
    );

    if (offenders.length > 0) {
      failures.push(
        `${relativePath}: <Row> has direct child <${offenders.join('>, <')}> instead of <Column>; react-email's Row is a <tr> and only <Column> renders a <td>`,
      );
    }
  }

  return failures;
}

export function checkEmailMarkup(root = REPO_ROOT) {
  const files = globSync('packages/twenty-emails/src/**/*.tsx', { cwd: root })
    .map((p) => p.split(sep).join(posix.sep))
    .filter(isScannedPath)
    .sort();

  if (files.length === 0) return ['no e-mail components were read at all'];

  return files.flatMap((relativePath) =>
    findEmailRowFailures({
      relativePath,
      source: readFileSync(resolve(root, relativePath), 'utf8'),
    }),
  );
}

// CRM-037 deleted every hero-card walkthrough video: they played from
// Twenty's own Vimeo account (player.vimeo.com) through a `vimeoId` prop on
// SettingsDiscoveryHeroCard. Neither name is a code identifier anyone has a
// reason to type again, so a bare substring match is enough and needs no
// allowlist.
export const VIMEO_REFERENCE_PATTERN = /\bvimeoId\b|player\.vimeo\.com/i;

export function checkNoVimeoReferences(root = REPO_ROOT) {
  const files = SCANNED_GLOBS.flatMap((pattern) =>
    globSync(pattern, { cwd: root }),
  )
    .map((p) => p.split(sep).join(posix.sep))
    .filter(isScannedPath)
    .sort();

  const failures = [];

  for (const relativePath of files) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');

    if (VIMEO_REFERENCE_PATTERN.test(source)) {
      failures.push(
        `${relativePath} references a Vimeo video (vimeoId or player.vimeo.com); CRM-037 removed every Twenty-hosted demo video`,
      );
    }
  }

  return failures;
}

export const BRAND_PUBLIC_ROOT = 'packages/twenty-front/public';

// Every brand asset path this repo names, from both places one can be written:
// the BRAND_ASSET_PATHS registry, and the `/brand/...` literals that Linaria
// template literals carry (a styled block cannot interpolate the registry, so
// those paths are typed out by hand).
//
// R2 split Brand.ts into one file per constant, so this reads every
// Brand*.ts under twenty-shared/constants rather than a single known name --
// whichever of them carries a `/brand/...` literal is still found.
export function collectBrandAssetReferences(root = REPO_ROOT) {
  const brandConstantFiles = globSync(
    'packages/twenty-shared/src/constants/Brand*.ts',
    { cwd: root },
  )
    .map((p) => p.split(sep).join(posix.sep))
    .sort();
  const declared = brandConstantFiles.flatMap((relativePath) => {
    const source = readFileSync(resolve(root, relativePath), 'utf8');

    return [...source.matchAll(/'(\/brand\/[^']+)'/g)].map((match) => ({
      path: match[1],
      from: relativePath.replace('packages/', '').replace('/src/', '/'),
    }));
  });
  const referenced = SCANNED_GLOBS.flatMap((pattern) =>
    globSync(pattern, { cwd: root }),
  )
    .map((p) => p.split(sep).join(posix.sep))
    .filter(isScannedPath)
    .flatMap((relativePath) => {
      const source = readFileSync(resolve(root, relativePath), 'utf8');

      return [...source.matchAll(/['"(](\/brand\/[^'")\s]+)['")]/g)].map(
        (match) => ({ path: match[1], from: relativePath }),
      );
    });

  return [...declared, ...referenced];
}

// A brand path that resolves to nothing is a missing logo in production and
// nothing anywhere else: no build step and no type checks it, because it is a
// runtime URL. This is the only thing standing between a typo and a blank tile.
export function checkBrandAssetsExist(root = REPO_ROOT) {
  const references = collectBrandAssetReferences(root);

  if (references.length === 0) return ['no brand asset path was read at all'];

  // One report per missing path, not one per place it is written: each
  // Brand*.ts file is both the registry and a scanned source, so it sees its
  // own entries twice.
  const missing = new Map();

  for (const reference of references) {
    if (missing.has(reference.path)) continue;
    if (existsSync(resolve(root, BRAND_PUBLIC_ROOT, `.${reference.path}`))) {
      continue;
    }
    missing.set(reference.path, reference.from);
  }

  return [...missing].map(
    ([path, from]) =>
      `${from} names ${path}, which does not exist under ${BRAND_PUBLIC_ROOT}`,
  );
}

export const SOCIAL_PREVIEW_META = [
  ['property', 'og:image'],
  ['name', 'twitter:image'],
];

// index.html is static and cannot import a constant, so the URL is written
// twice. This reads the one in BrandSocialPreviewImageUrl.ts -- R2 split it
// out of Brand.ts, but it is still the single place the brand's own social
// image URL lives -- and requires index.html to agree with it, so the pair
// cannot drift apart silently.
export function readDeclaredSocialPreviewImage(root = REPO_ROOT) {
  const source = readFileSync(
    resolve(
      root,
      'packages/twenty-shared/src/constants/BrandSocialPreviewImageUrl.ts',
    ),
    'utf8',
  );

  return /BRAND_SOCIAL_PREVIEW_IMAGE_URL\s*=\s*['"]([^'"]+)['"]/.exec(
    source,
  )?.[1];
}

// A social card is fetched by a crawler on its OWN network, from a page it may
// have been handed as a bare URL, so a path relative to this deployment is not
// a URL it can resolve. Absolute https or the card renders blank.
export function checkSocialPreviewMetadata(root = REPO_ROOT) {
  const source = readFileSync(
    resolve(root, 'packages/twenty-front/index.html'),
    'utf8',
  );
  const failures = [];
  const declared = existsSync(
    resolve(
      root,
      'packages/twenty-shared/src/constants/BrandSocialPreviewImageUrl.ts',
    ),
  )
    ? readDeclaredSocialPreviewImage(root)
    : undefined;

  for (const [attribute, name] of SOCIAL_PREVIEW_META) {
    const tag = [...source.matchAll(/<meta\b[^>]*>/g)]
      .map((match) => match[0])
      .find((candidate) =>
        new RegExp(`${attribute}="${name}"`).test(candidate),
      );

    if (!tag) {
      failures.push(`index.html declares no <meta ${attribute}="${name}">`);
      continue;
    }

    const content = /content="([^"]*)"/.exec(tag)?.[1];

    if (!content || !content.startsWith('https://')) {
      failures.push(
        `index.html ${name} is ${JSON.stringify(content ?? null)}, which is not an absolute https URL a crawler can fetch`,
      );
      continue;
    }

    if (declared !== undefined && content !== declared) {
      failures.push(
        `index.html ${name} is ${JSON.stringify(content)} but BRAND_SOCIAL_PREVIEW_IMAGE_URL declares ${JSON.stringify(declared)}`,
      );
    }
  }

  if (declared === undefined) {
    failures.push(
      'packages/twenty-shared/src/constants/BrandSocialPreviewImageUrl.ts declares no BRAND_SOCIAL_PREVIEW_IMAGE_URL for index.html to agree with',
    );
  }

  return failures;
}

function run() {
  const markupFailures = [
    ...checkBrandAssetsExist(),
    ...checkEmailMarkup(),
    ...checkSocialPreviewMetadata(),
    ...checkNoVimeoReferences(),
  ];

  if (markupFailures.length > 0) {
    for (const failure of markupFailures) console.error(`[FAIL] ${failure}`);
    process.exit(1);
  }

  const themeFailures = checkThemeIdentity();

  if (themeFailures.length > 0) {
    for (const failure of themeFailures) console.error(`[FAIL] ${failure}`);
    console.error(
      `[FAIL] the generated theme does not carry the brand palette and typography. Edit packages/twenty-ui/design-tokens and run: npx nx generateTokens twenty-ui`,
    );
    process.exit(1);
  }

  const { filesScanned, violations } = scanRepository();

  if (filesScanned === 0) {
    console.error(
      '[FAIL] the brand guard matched no files at all, so it measured nothing',
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    for (const violation of violations.slice(0, 50)) {
      console.error(
        `[FAIL] ${violation.file}: ${violation.kind} ${JSON.stringify(violation.text)} in ${JSON.stringify(violation.inside.slice(0, 120))}`,
      );
    }
    if (violations.length > 50) {
      console.error(`[FAIL] ... and ${violations.length - 50} more`);
    }
    console.error(
      `[FAIL] ${violations.length} user-visible reference(s) to Twenty across ${filesScanned} scanned files. Rename them, or add an allowlist entry with a reason in scripts/aos/verify-brand.mjs.`,
    );
    process.exit(1);
  }

  console.log(
    `[PASS] no user-visible reference to Twenty, and no reference to a Twenty-branded asset file, in ${filesScanned} shipped source files (${ALLOWLIST.length} allowlisted exceptions, each with a reason).`,
  );
  console.log(
    `[PASS] every brand asset path this repo names exists on disk, every <Row> in the e-mail package wraps its children in <Column>, and index.html names an absolute https image for both social preview cards.`,
  );
  console.log(
    'Scope: string literals, template literals and same-line JSX text in the front, ui, shared, emails and server packages, plus index.html. It does NOT read the rendered page (see scripts/aos/verify-front-icons.mjs and scripts/aos/test/crm-brand-e2e.test.mjs) and does NOT observe network traffic (see scripts/aos/capture-traffic.mjs).',
  );
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try {
      body();
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.log(`[FAIL] ${name}: ${error.message}`);
      failures++;
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const scan = (source, relativePath = 'packages/twenty-front/src/fixture.tsx') =>
    findViolations({ relativePath, source });

  record('a seeded visible "Twenty" in a Lingui message FAILS the guard', () => {
    const found = scan('const title = t`Welcome to Twenty`;');
    assert(found.length === 1, `expected 1 violation, got ${found.length}`);
    assert(found[0].kind === 'twenty-name', found[0].kind);
  });
  record('the same message saying Betty passes', () => {
    assert(scan('const title = t`Welcome to Betty`;').length === 0, 'Betty was flagged');
  });
  record('a seeded "Twenty" in JSX text FAILS', () => {
    const found = scan('<Trans>By using Twenty, you agree to the</Trans>');
    assert(found.length >= 1, 'JSX text was not read');
  });
  record('a seeded "Twenty" in a prop string FAILS', () => {
    for (const source of [
      '<Section.Header title="Twenty fields" />',
      "const message = 'Please contact Twenty team';",
      'const subject = msg`Join your team on Twenty`;',
      "i18n._('Twenty logo')",
    ]) {
      assert(scan(source).length >= 1, `not flagged: ${source}`);
    }
  });
  record('a seeded Twenty-hosted URL FAILS, for every host family that leaked', () => {
    for (const url of [
      'https://docs.twenty.com/getting-started',
      'https://twenty-icons.com/acme.com',
      'https://twenty-telemetry.com/api/v2',
      'https://twentyhq.github.io/placeholder-images/x.png',
      'https://app.twenty.com/images/icons/x.png',
    ]) {
      const found = scan(`const url = '${url}';`);
      assert(
        found.some((violation) => violation.kind === 'twenty-host'),
        `not flagged as a host: ${url}`,
      );
    }
  });
  record('a bare Twenty domain with no "https://" FAILS, the exact shape example data took', () => {
    for (const source of [
      "const email = 'tim@twenty.com';",
      "const primaryLinkUrl = 'twenty.com';",
      "const value = 'twentyhq.io';",
    ]) {
      const found = scan(source);
      assert(
        found.some((violation) => violation.kind === 'twenty-host'),
        `not flagged as a bare host: ${source}`,
      );
    }
  });
  record('code identifiers, package names and import paths are NOT flagged', () => {
    for (const source of [
      "import { BRAND_NAME } from 'twenty-shared/constants';",
      "import { isTwentyStandardApplication } from '@/applications/utils/isTwentyStandardApplication';",
      'const x = isTwentyStandardApplication(app);',
      'type WhatIsTwentyProps = { i18n: I18n };',
      'export class TwentyConfigService {}',
      "} from 'twenty-ui/theme';",
      '// the upstream Twenty footer linked three sites',
    ]) {
      assert(scan(source).length === 0, `false positive: ${source}`);
    }
  });
  record('index.html text, title, meta and hrefs are read', () => {
    const html = '<title>Twenty</title><meta property="og:title" content="Twenty" />';
    const found = findViolations({
      relativePath: 'packages/twenty-front/index.html',
      source: html,
    });
    assert(found.length >= 2, `expected the title and the meta, got ${found.length}`);
  });
  record("this repo's own index.html says Betty and nothing else", () => {
    const found = findViolations({
      relativePath: 'packages/twenty-front/index.html',
      source: readFileSync(
        resolve(REPO_ROOT, 'packages/twenty-front/index.html'),
        'utf8',
      ),
    });
    assert(found.length === 0, `index.html still names Twenty: ${JSON.stringify(found)}`);
  });
  record('the allowlist is explicit: no wildcards, no bare directories', () => {
    for (const entry of ALLOWLIST) {
      assert(!/[*?]/.test(entry.file), `wildcard in allowlist file: ${entry.file}`);
      assert(entry.match.length >= 6, `allowlist match too broad: ${entry.match}`);
      assert(
        typeof entry.reason === 'string' && entry.reason.length > 30,
        `allowlist entry without a real reason: ${entry.file}`,
      );
    }
  });
  record('every allowlist entry still names a file that exists and text it still excuses', () => {
    for (const entry of ALLOWLIST) {
      statSync(resolve(REPO_ROOT, entry.file));
      const source = readFileSync(resolve(REPO_ROOT, entry.file), 'utf8');
      assert(
        source.includes(entry.match),
        `stale allowlist entry: ${entry.file} no longer contains ${JSON.stringify(entry.match)}`,
      );
    }
  });
  record('an allowlist entry excuses only its own file', () => {
    const entry = ALLOWLIST[0];
    const violation = {
      file: 'packages/twenty-front/src/other.tsx',
      text: 'Twenty',
      inside: entry.match,
    };
    assert(!isAllowed(violation, [entry]), 'the allowlist leaked across files');
  });
  record('generated catalogues, tests, mocks and stories are out of scope', () => {
    for (const path of [
      'packages/twenty-front/src/locales/es-ES.po',
      'packages/twenty-front/src/locales/generated/en.ts',
      'packages/twenty-front/src/modules/x/__tests__/y.test.tsx',
      'packages/twenty-front/src/modules/x/__mocks__/y.ts',
      'packages/twenty-front/src/modules/x/__stories__/y.stories.tsx',
      'packages/twenty-front/src/testing/mock-data/users.ts',
      'packages/twenty-server/src/x/y.spec.ts',
    ]) {
      assert(!isScannedPath(path), `should be skipped: ${path}`);
    }
    for (const path of [
      'packages/twenty-front/src/pages/auth/SignInUp.tsx',
      'packages/twenty-emails/src/components/Footer.tsx',
      'packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts',
    ]) {
      assert(isScannedPath(path), `should be scanned: ${path}`);
    }
  });
  record("the generated theme carries the brand's palette and typography, in both schemes", () => {
    const failures = checkThemeIdentity();
    assert(failures.length === 0, failures.join('; '));
  });
  record('a theme that still names Inter, or a blue accent, FAILS', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'aos-brand-theme-'));

    try {
      for (const relative of THEME_ARTIFACTS) {
        mkdirSync(dirname(resolve(sandbox, relative)), { recursive: true });
      }
      const [light, dark] = THEME_ARTIFACTS;
      // A theme with upstream's family and accent, which is what a reverted or
      // unregenerated token source produces.
      writeFileSync(
        resolve(sandbox, light),
        "--t-font-family: Inter, sans-serif;\n--t-font-family-display: 'Fraunces', Georgia, serif;\n--t-font-color-primary: #35362e;\n--t-background-primary: #fffdf9;\n--t-accent-primary: #0047f1;\n",
      );
      writeFileSync(resolve(sandbox, dark), '');

      const failures = checkThemeIdentity(sandbox);

      assert(
        failures.some((failure) => /still names Inter/.test(failure)),
        `Inter was not reported: ${failures.join('; ')}`,
      );
      assert(
        failures.some((failure) => /--t-accent-primary/.test(failure)),
        `the blue accent was not reported: ${failures.join('; ')}`,
      );
      assert(
        failures.some((failure) => /declares no/.test(failure)),
        `the empty dark theme was not reported: ${failures.join('; ')}`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
  record('a reference to a Twenty-branded ASSET FILE fails, even with no host and no word', () => {
    for (const source of [
      "const logo = '/images/integrations/twenty-logo.svg';",
      "background-image: url('/images/integrations/twenty-logo.svg');",
      "const url = `${window.location.origin}/images/icons/android/android-launchericon-192-192.png`;",
      "background-image: url('/images/integrations/oauth-modal-header.png');",
      "const art = '/images/onboarding/welcome-halftone.svg';",
      "const tile = '/images/icons/windows11/Square150x150Logo.scale-100.png';",
      "const splash = '/images/icons/windows11/SplashScreen.scale-200.png';",
    ]) {
      const found = scan(source);

      assert(
        found.some((violation) => violation.kind === 'twenty-asset'),
        `not flagged as a Twenty asset: ${source}`,
      );
    }
  });
  record("the brand's own assets and third-party logos are NOT flagged", () => {
    for (const source of [
      "const logo = '/brand/logo/betty-app-icon.svg';",
      "background-image: url('/brand/ornament/betty-hilo-corto.svg');",
      "const badge = '/images/onboarding/trust-badges/soc2.png';",
      "const client = '/images/integrations/slack-logo.png';",
      "const hero = '/images/ai/ai-tools-cover-light.png';",
    ]) {
      assert(scan(source).length === 0, `false positive: ${source}`);
    }
  });
  record('this repo names no Twenty-branded asset file anywhere in scope', () => {
    const { violations } = scanRepository();
    const assets = violations.filter(
      (violation) => violation.kind === 'twenty-asset',
    );

    assert(assets.length === 0, JSON.stringify(assets.slice(0, 5)));
  });
  record('a vimeoId prop left in shipped front code FAILS', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'aos-brand-vimeo-'));

    try {
      const file = resolve(sandbox, 'packages/twenty-front/src/fixture.tsx');

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "const tabs = [{ id: 'x', vimeoId: '1217964358' }];\n");

      const failures = checkNoVimeoReferences(sandbox);

      assert(
        failures.some((failure) => /vimeoId/.test(failure)),
        `vimeoId was not reported: ${failures.join('; ')}`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
  record('a player.vimeo.com embed URL left in shipped front code FAILS', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'aos-brand-vimeo-'));

    try {
      const file = resolve(sandbox, 'packages/twenty-front/src/fixture.tsx');

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        "const src = `https://player.vimeo.com/video/${id}`;\n",
      );

      const failures = checkNoVimeoReferences(sandbox);

      assert(
        failures.some((failure) => /player\.vimeo\.com/.test(failure)),
        `player.vimeo.com was not reported: ${failures.join('; ')}`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
  record('this repo embeds no Vimeo video anywhere in scope', () => {
    const failures = checkNoVimeoReferences();

    assert(failures.length === 0, failures.join('; '));
  });
  record('every brand asset path this repo names exists on disk', () => {
    const references = collectBrandAssetReferences();

    assert(references.length >= 8, `only ${references.length} paths read`);
    assert(
      references.some((reference) => /\.tsx$/.test(reference.from)),
      'no brand path was read out of a component, so the Linaria literals are unmeasured',
    );
    const failures = checkBrandAssetsExist();

    assert(failures.length === 0, failures.join('; '));
  });
  record('a brand path that resolves to nothing FAILS', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'aos-brand-assets-'));

    try {
      const brandPath = resolve(
        sandbox,
        'packages/twenty-shared/src/constants/BrandAssetPaths.ts',
      );

      mkdirSync(dirname(brandPath), { recursive: true });
      mkdirSync(resolve(sandbox, BRAND_PUBLIC_ROOT, 'brand/logo'), {
        recursive: true,
      });
      writeFileSync(
        resolve(sandbox, BRAND_PUBLIC_ROOT, 'brand/logo/there.svg'),
        '<svg/>',
      );
      writeFileSync(
        brandPath,
        "export const BRAND_ASSET_PATHS = { a: '/brand/logo/there.svg', b: '/brand/logo/typo.svg' };\n",
      );

      const failures = checkBrandAssetsExist(sandbox);

      assert(failures.length === 1, JSON.stringify(failures));
      assert(/typo\.svg/.test(failures[0]), failures[0]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
  record('a <Row> whose direct child is not a <Column> FAILS', () => {
    // The exact shape the independent review found in Footer.tsx: a ShadowText
    // straight inside a Row, which is a non-<td> inside a <tr>.
    const broken = `<Row>\n  <ShadowText>\n    <Link href="x" value="y" />\n  </ShadowText>\n</Row>`;
    const failures = findEmailRowFailures({
      relativePath: 'packages/twenty-emails/src/components/Footer.tsx',
      source: broken,
    });

    assert(failures.length === 1, `expected 1 failure, got ${failures.length}`);
    assert(/<ShadowText>/.test(failures[0]), failures[0]);
  });
  record('the same markup wrapped in <Column> passes, and nesting is not miscounted', () => {
    const wrapped = `<Row>\n  <Column>\n    <ShadowText>\n      <Link href="x" value="y" />\n    </ShadowText>\n  </Column>\n</Row>`;

    assert(
      findEmailRowFailures({ relativePath: 'f.tsx', source: wrapped }).length === 0,
      'a wrapped Row was flagged',
    );
    assert(
      directChildTagNames('<Column><Link /></Column><Column>x</Column>').join() ===
        'Column,Column',
      directChildTagNames('<Column><Link /></Column><Column>x</Column>').join(),
    );
  });
  record('a Column inside a Fragment still counts as the <td>', () => {
    const fragment = `<Row>\n  <Fragment key={i}>\n    <Column>x</Column>\n  </Fragment>\n</Row>`;

    assert(
      findEmailRowFailures({ relativePath: 'f.tsx', source: fragment }).length === 0,
      'a Column wrapped in a Fragment was flagged',
    );
    // ... and a Fragment is not a hole the real offender can hide in.
    const hidden = `<Row>\n  <Fragment>\n    <ShadowText>x</ShadowText>\n  </Fragment>\n</Row>`;

    assert(
      findEmailRowFailures({ relativePath: 'f.tsx', source: hidden }).length === 1,
      'a non-Column inside a Fragment was not flagged',
    );
  });
  record('every <Row> in this repo wraps in <Column>', () => {
    const failures = checkEmailMarkup();

    assert(failures.length === 0, failures.join('; '));
  });
  record('a RELATIVE social preview image FAILS, a missing tag too, and so does drift', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'aos-brand-social-'));

    try {
      const htmlPath = resolve(sandbox, 'packages/twenty-front/index.html');
      const brandPath = resolve(
        sandbox,
        'packages/twenty-shared/src/constants/BrandSocialPreviewImageUrl.ts',
      );

      mkdirSync(dirname(htmlPath), { recursive: true });
      mkdirSync(dirname(brandPath), { recursive: true });
      writeFileSync(
        brandPath,
        "export const BRAND_SOCIAL_PREVIEW_IMAGE_URL = 'https://brand.test/icon.png';\n",
      );
      // What the review found: both cards pointing at a path no crawler can
      // resolve.
      writeFileSync(
        htmlPath,
        '<meta property="og:image" content="/brand/logo/icon-512.png" />\n<meta name="twitter:image" content="/brand/logo/icon-512.png" />\n',
      );

      const relative = checkSocialPreviewMetadata(sandbox);

      assert(relative.length === 2, JSON.stringify(relative));
      assert(
        relative.every((failure) => /not an absolute https URL/.test(failure)),
        JSON.stringify(relative),
      );

      writeFileSync(htmlPath, '<title>Betty</title>\n');
      const missing = checkSocialPreviewMetadata(sandbox);

      assert(missing.length === 2, JSON.stringify(missing));
      assert(
        missing.every((failure) => /declares no <meta/.test(failure)),
        JSON.stringify(missing),
      );

      writeFileSync(
        htmlPath,
        '<meta property="og:image" content="https://brand.test/icon.png" />\n<meta name="twitter:image" content="https://elsewhere.test/other.png" />\n',
      );
      const drifted = checkSocialPreviewMetadata(sandbox);

      assert(drifted.length === 1, JSON.stringify(drifted));
      assert(/twitter:image/.test(drifted[0]), drifted[0]);

      rmSync(brandPath);
      assert(
        checkSocialPreviewMetadata(sandbox).some((failure) =>
          /declares no BRAND_SOCIAL_PREVIEW_IMAGE_URL/.test(failure),
        ),
        'a missing brand constant was not reported',
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
  record("this repo's index.html names an absolute https image for both cards", () => {
    const failures = checkSocialPreviewMetadata();

    assert(failures.length === 0, failures.join('; '));
  });
  record('the guard is declared in the gate with its self-test', () => {
    const verify = JSON.parse(readFileSync(resolveGateFile(), 'utf8'));
    assert(
      verify.commands.includes('node scripts/aos/verify-brand.mjs'),
      'the brand guard is not in .aos/verify.json',
    );
    assert(
      verify.commands.includes('node scripts/aos/verify-brand.mjs --self-test'),
      'the brand guard self-test is not in .aos/verify.json',
    );
  });

  console.log(
    failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// Only act when this file IS the entry point, resolved by real path rather
// than by the name it was invoked under (CRM-004 fix5's lesson). Other
// verifiers import resolveGateFile from here, and an import must not run a
// scan.
const invokedPath = process.argv[1]
  ? resolve(process.argv[1])
  : null;

if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else run();
}
