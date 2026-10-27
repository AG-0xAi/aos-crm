// CRM-003 privacy gate. Static contract checks only: never starts the app,
// never imports/executes any Twenty module, never resolves a real secret.
// Two kinds of check, kept visibly separate:
//   1. deploy/local/privacy.env's own contract (required key/value pairs,
//      and an explicit absence of DSN/key/secret-shaped variable names --
//      this file is a versioned, NON-SECRET flag profile, not a place for
//      real credentials; those stay in deploy/local/.env, gitignored).
//   2. Source-inspection checks against the REAL pinned twenty/v2.51.0
//      files this profile depends on (config-variables.ts, twenty-config
//      service/module, telemetry.service.ts, instrument.ts,
//      client-config.service.ts, SentryInitEffect.tsx,
//      enterprise-plan.service.ts, cron-register-all.command.ts) --
//      string/ordering checks on the real text, proving the guard this
//      profile relies on is still shaped the way docs/aos/bootstrap/
//      TELEMETRY_AUDIT.md documents it, not a synthetic fixture and not an
//      app execution.
// This is NOT the runtime no-send proof: that is
// packages/twenty-server/src/engine/core-modules/telemetry/__tests__/telemetry.service.spec.ts
// (a real Jest unit test with an HTTP spy), which requires the monorepo's
// dependencies to be installed and is therefore a separate, explicitly
// not-yet-executed deliverable for CRM-004 -- see .aos/reports/CRM-003.md.
// Run: node scripts/aos/verify-privacy.mjs
// Self-test (isolated string fixtures only, never the real repo files):
//   node scripts/aos/verify-privacy.mjs --self-test
import { readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..', '..');

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function readRepoFileOrNull(relPath) {
  try {
    return readFileSync(join(REPO_ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// deploy/local/privacy.env contract. Mirrors scripts/aos/local.ps1's
// Read-EnvKeys/Test-RequiredExactKeys exactly (skip blank/'#'-led lines,
// split on the first '=', trim, last occurrence of a duplicate key wins)
// so this gate and local.ps1's own fail-closed check never disagree about
// what the file says.
// ---------------------------------------------------------------------------

function parseEnvFile(text) {
  const found = new Map();
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    if (key === '') continue;
    found.set(key, line.slice(idx + 1).trim());
  }
  return found;
}

// Every key here is a real flag confirmed against the pinned
// config-variables.ts (see the source-inspection checks below and
// docs/aos/bootstrap/TELEMETRY_AUDIT.md) -- never an invented variable.
const REQUIRED_PRIVACY_KEYS = new Map([
  ['TELEMETRY_ENABLED', 'false'],
  ['ANALYTICS_ENABLED', 'false'],
  ['MARKETPLACE_CATALOG_SYNC_CRON_ENABLED', 'false'],
  ['IS_CONFIG_VARIABLES_IN_DB_ENABLED', 'false'],
  ['EXCEPTION_HANDLER_DRIVER', 'CONSOLE'],
  ['LOGIC_FUNCTION_TYPE', 'DISABLED'],
  ['CODE_INTERPRETER_TYPE', 'DISABLED'],
]);

function checkPrivacyEnvContract(text) {
  const found = parseEnvFile(text);
  const missing = [];
  const wrong = [];
  for (const [key, expected] of REQUIRED_PRIVACY_KEYS) {
    if (!found.has(key)) {
      missing.push(key);
      continue;
    }
    if (found.get(key) !== expected) wrong.push(key);
  }
  const ok = missing.length === 0 && wrong.length === 0;
  return {
    ok,
    detail: ok
      ? `all ${REQUIRED_PRIVACY_KEYS.size} required privacy.env keys are present at their required value`
      : `missing=${JSON.stringify(missing)}, wrongValue=${JSON.stringify(wrong)}`,
  };
}

// Guards against the file drifting from "non-secret flag profile" to
// "accidentally holds a real DSN/key/token" -- names only, never values,
// so this check itself can never leak a secret even if one were pasted in.
const FORBIDDEN_SECRET_SHAPED_KEYS = new Set([
  'SENTRY_DSN',
  'SENTRY_FRONT_DSN',
  'CLICKHOUSE_URL',
  'ENTERPRISE_KEY',
]);
const FORBIDDEN_SECRET_SHAPED_SUFFIXES = [
  '_PASSWORD',
  '_SECRET',
  '_TOKEN',
  '_API_KEY',
  '_ACCESS_KEY',
  '_SECRET_ACCESS_KEY',
];

function checkPrivacyEnvCarriesNoSecretsOrDsn(text) {
  const found = parseEnvFile(text);
  const present = [...found.keys()].filter(
    (key) =>
      FORBIDDEN_SECRET_SHAPED_KEYS.has(key) ||
      FORBIDDEN_SECRET_SHAPED_SUFFIXES.some((suffix) => key.endsWith(suffix)),
  );
  const ok = present.length === 0;
  return {
    ok,
    detail: ok
      ? 'no DSN/key/secret-shaped variable name present (this check never reads or prints a value)'
      : `secret-shaped key name(s) present in this versioned file: ${present.join(', ')} (name only -- value never read by this check)`,
  };
}

// ---------------------------------------------------------------------------
// Source-inspection checks: real pinned twenty/v2.51.0 text, string/order
// matches only, never imported/executed.
// ---------------------------------------------------------------------------

function checkConfigVariablesPrivacyDefaults(text) {
  const expectations = [
    ['TELEMETRY_ENABLED', /TELEMETRY_ENABLED\s*=\s*true;/],
    ['ANALYTICS_ENABLED', /ANALYTICS_ENABLED\s*=\s*false;/],
    ['MARKETPLACE_CATALOG_SYNC_CRON_ENABLED', /MARKETPLACE_CATALOG_SYNC_CRON_ENABLED\s*=\s*true;/],
    ['IS_CONFIG_VARIABLES_IN_DB_ENABLED', /IS_CONFIG_VARIABLES_IN_DB_ENABLED\s*=\s*true;/],
  ];
  const missing = expectations.filter(([, re]) => !re.test(text)).map(([name]) => name);
  const ok = missing.length === 0;
  return {
    ok,
    detail: ok
      ? 'config-variables.ts still declares TELEMETRY_ENABLED/ANALYTICS_ENABLED/MARKETPLACE_CATALOG_SYNC_CRON_ENABLED/IS_CONFIG_VARIABLES_IN_DB_ENABLED with the upstream defaults this profile explicitly overrides'
      : `upstream declaration/default no longer matches for: ${missing.join(', ')} (variable renamed, removed, or default changed -- re-inspect before trusting this profile)`,
  };
}

function textWindowBefore(text, marker, chars) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  return text.slice(Math.max(0, idx - chars), idx);
}

function checkExceptionHandlerDriverIsEnvOnly(text) {
  const windowText = textWindowBefore(text, 'EXCEPTION_HANDLER_DRIVER: ExceptionHandlerDriver', 400);
  const ok = windowText !== null && /isEnvOnly:\s*true/.test(windowText);
  return {
    ok,
    detail: ok
      ? 'EXCEPTION_HANDLER_DRIVER metadata carries isEnvOnly: true -- it can never be overridden from the database regardless of IS_CONFIG_VARIABLES_IN_DB_ENABLED'
      : 'EXCEPTION_HANDLER_DRIVER declaration not found, or its metadata no longer carries isEnvOnly: true nearby',
  };
}

function checkConfigModuleGatesDatabaseDriverByEnv(text) {
  const gateIdx = text.search(/process\.env\.IS_CONFIG_VARIABLES_IN_DB_ENABLED\s*!==\s*['"]false['"]/);
  const importIdx = text.indexOf('DatabaseConfigModule.forRoot()');
  const ok = gateIdx !== -1 && importIdx !== -1 && gateIdx < importIdx;
  return {
    ok,
    detail: ok
      ? "twenty-config.module.ts only imports DatabaseConfigModule when process.env.IS_CONFIG_VARIABLES_IN_DB_ENABLED !== 'false' -- with it false, the database config driver provider never exists in the module graph"
      : 'twenty-config.module.ts no longer gates the DatabaseConfigModule import by IS_CONFIG_VARIABLES_IN_DB_ENABLED the same way',
  };
}

function checkConfigServiceComputesDriverActiveFromEnv(text) {
  const readsRawEnv = /environmentConfigDriver\.get\(\s*['"]IS_CONFIG_VARIABLES_IN_DB_ENABLED['"],?\s*\)/.test(text);
  const andsWithDriverPresence = /isDatabaseDriverActive\s*=\s*\n?\s*isConfigVariablesInDbEnabled\s*&&\s*!!this\.databaseConfigDriver/.test(text);
  const ok = readsRawEnv && andsWithDriverPresence;
  return {
    ok,
    detail: ok
      ? "isDatabaseDriverActive is computed once, in the constructor, from environmentConfigDriver.get('IS_CONFIG_VARIABLES_IN_DB_ENABLED') AND-ed with whether a database driver instance exists at all"
      : 'twenty-config.service.ts no longer computes isDatabaseDriverActive the same way from the raw environment read',
  };
}

function checkConfigServiceSkipsDbWhenInactive(text) {
  const getIdx = text.indexOf('get<T extends keyof ConfigVariables>(key: T): ConfigVariables[T] {');
  if (getIdx === -1) return { ok: false, detail: 'get<T>(key) method not found in twenty-config.service.ts' };
  const body = text.slice(getIdx, getIdx + 500);
  const checksDbActive = /if\s*\(this\.isDatabaseDriverActive\)/.test(body);
  const fallsBackToEnv = /return this\.environmentConfigDriver\.get\(key\);/.test(body);
  const ok = checksDbActive && fallsBackToEnv;
  return {
    ok,
    detail: ok
      ? 'get(key) only consults the database driver when isDatabaseDriverActive is true; otherwise (our profile) it always falls back to environmentConfigDriver.get(key), so a persisted DB override cannot resurface while the flag is false'
      : 'get(key) no longer visibly gates the database read behind isDatabaseDriverActive',
  };
}

function checkTelemetryServiceGuardsBeforeHttp(text) {
  const guardIdx = text.search(/if\s*\(!this\.twentyConfigService\.get\(\s*['"]TELEMETRY_ENABLED['"]\s*\)\)/);
  const httpClientIdx = text.indexOf('getHttpClient(');
  const postIdx = text.indexOf('.post(');
  const ok = guardIdx !== -1 && httpClientIdx !== -1 && postIdx !== -1 && guardIdx < httpClientIdx && guardIdx < postIdx;
  return {
    ok,
    detail: ok
      ? 'TelemetryService.publish() checks TELEMETRY_ENABLED and returns before creating an HTTP client or calling .post(...) -- the no-send path never constructs a client'
      : `guard/HTTP-client/post ordering changed (guardIdx=${guardIdx}, httpClientIdx=${httpClientIdx}, postIdx=${postIdx}; expected guard strictly before both)`,
  };
}

function checkInstrumentGatesSentryByDriver(text) {
  const condIdx = text.search(/if\s*\(\s*process\.env\.EXCEPTION_HANDLER_DRIVER === ExceptionHandlerDriver\.SENTRY\s*\)\s*\{/);
  const initIdx = text.indexOf('Sentry.init(');
  const ok = condIdx !== -1 && initIdx !== -1 && condIdx < initIdx;
  return {
    ok,
    detail: ok
      ? 'instrument.ts only calls Sentry.init(...) inside the EXCEPTION_HANDLER_DRIVER === SENTRY branch, read directly from process.env before Nest even bootstraps'
      : `Sentry.init gating changed (condIdx=${condIdx}, initIdx=${initIdx})`,
  };
}

function checkInstrumentMeterDriverDefaultsEmpty(text) {
  const ok = /parseArrayEnvVar\(\s*process\.env\.METER_DRIVER,\s*Object\.values\(MeterDriver\),\s*\[\]\s*,?\s*\)/.test(text);
  return {
    ok,
    detail: ok
      ? 'METER_DRIVER defaults to [] (no console/OpenTelemetry/Prometheus exporter wired) when unset'
      : 'instrument.ts no longer defaults METER_DRIVER to an empty array the same way',
  };
}

function checkClientConfigPropagatesPrivacyFlags(text) {
  const hasSentryDsn = /dsn:\s*this\.twentyConfigService\.get\(\s*['"]SENTRY_FRONT_DSN['"]\s*\)/.test(text);
  const hasAnalytics = /analyticsEnabled:\s*this\.twentyConfigService\.get\(\s*['"]ANALYTICS_ENABLED['"]\s*\)/.test(text);
  const ok = hasSentryDsn && hasAnalytics;
  return {
    ok,
    detail: ok
      ? 'clientConfig still exposes sentry.dsn from SENTRY_FRONT_DSN and analyticsEnabled from ANALYTICS_ENABLED -- the two server flags the front end actually receives'
      : `clientConfig propagation changed (sentryDsnPropagated=${hasSentryDsn}, analyticsEnabledPropagated=${hasAnalytics})`,
  };
}

function checkSentryInitEffectGatedOnDsn(text) {
  const guardIdx = text.search(/isNonEmptyString\(\s*sentryConfig\?\.dsn\s*\)/);
  const importIdx = text.indexOf("await import('@sentry/react')");
  const initIdx = text.indexOf('init({');
  const ok = guardIdx !== -1 && importIdx !== -1 && initIdx !== -1 && guardIdx < importIdx && guardIdx < initIdx;
  return {
    ok,
    detail: ok
      ? "SentryInitEffect only dynamic-imports '@sentry/react' and calls init(...) when sentryConfig.dsn is a non-empty string -- with SENTRY_FRONT_DSN unset, the front end never loads the SDK"
      : `Sentry front-end init gating changed (guardIdx=${guardIdx}, importIdx=${importIdx}, initIdx=${initIdx})`,
  };
}

function checkEnterpriseServiceNoNetworkWithoutKey(text) {
  function checkFn(startMarker, windowSize) {
    const idx = text.indexOf(startMarker);
    if (idx === -1) return { ok: false, detail: `marker not found: ${startMarker}` };
    const body = text.slice(idx, idx + windowSize);
    const guardIdx = body.search(/if\s*\(!enterpriseKey\)/);
    const fetchIdx = body.indexOf('fetch(');
    const ok = guardIdx !== -1 && fetchIdx !== -1 && guardIdx < fetchIdx;
    return {
      ok,
      detail: ok
        ? `${startMarker.split('(')[0]} checks ENTERPRISE_KEY and returns before any fetch(...)`
        : `${startMarker.split('(')[0]}: guard/fetch ordering changed (guardIdx=${guardIdx}, fetchIdx=${fetchIdx})`,
    };
  }
  const refresh = checkFn('async refreshValidityToken(): Promise<boolean> {', 900);
  const report = checkFn('async reportSeats(seatCount: number): Promise<boolean> {', 900);
  const ok = refresh.ok && report.ok;
  return {
    ok,
    detail: ok
      ? `${refresh.detail}; ${report.detail} -- the Enterprise cron job always registers, but neither call ever reaches the network without a configured ENTERPRISE_KEY`
      : `refreshValidityToken: ${refresh.detail} | reportSeats: ${report.detail}`,
  };
}

function checkMarketplaceCronGatedByConfigFlag(text) {
  const readIdx = text.search(/const isMarketplaceCatalogSyncEnabled = this\.twentyConfigService\.get\(\s*\n?\s*['"]MARKETPLACE_CATALOG_SYNC_CRON_ENABLED['"],?\s*\n?\s*\);/);
  const attachedIdx = text.search(/name:\s*['"]MarketplaceCatalogSync['"],[\s\S]{0,80}?isEnabled:\s*isMarketplaceCatalogSyncEnabled/);
  const skipLogicIdx = text.search(/if\s*\(!isEnabled\)\s*\{/);
  const ok = readIdx !== -1 && attachedIdx !== -1 && skipLogicIdx !== -1;
  return {
    ok,
    detail: ok
      ? 'cron:register:all reads MARKETPLACE_CATALOG_SYNC_CRON_ENABLED and skips registering the MarketplaceCatalogSync repeat job entirely when it is false (the job is never scheduled, not merely disabled while scheduled)'
      : `cron gating changed (readIdx=${readIdx}, attachedIdx=${attachedIdx}, skipLogicIdx=${skipLogicIdx})`,
  };
}

// ---------------------------------------------------------------------------
// main: real repo files only, no app execution.
// ---------------------------------------------------------------------------

const SOURCE_INSPECTION_FILES = {
  configVariables: 'packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts',
  configModule: 'packages/twenty-server/src/engine/core-modules/twenty-config/twenty-config.module.ts',
  configService: 'packages/twenty-server/src/engine/core-modules/twenty-config/twenty-config.service.ts',
  telemetryService: 'packages/twenty-server/src/engine/core-modules/telemetry/telemetry.service.ts',
  instrument: 'packages/twenty-server/src/instrument.ts',
  clientConfigService: 'packages/twenty-server/src/engine/core-modules/client-config/services/client-config.service.ts',
  sentryInitEffect: 'packages/twenty-front/src/modules/error-handler/components/SentryInitEffect.tsx',
  enterprisePlanService: 'packages/twenty-server/src/engine/core-modules/enterprise/services/enterprise-plan.service.ts',
  cronRegisterAll: 'packages/twenty-server/src/database/commands/cron-register-all.command.ts',
};

function main() {
  const results = [];

  const privacyEnvText = readRepoFileOrNull('deploy/local/privacy.env');
  if (privacyEnvText === null) {
    results.push({ name: 'privacy-env:exists', ok: false, detail: 'deploy/local/privacy.env is missing' });
  } else {
    results.push({ name: 'privacy-env:required-contract', ...checkPrivacyEnvContract(privacyEnvText) });
    results.push({ name: 'privacy-env:no-secrets-or-dsn', ...checkPrivacyEnvCarriesNoSecretsOrDsn(privacyEnvText) });
  }

  const configVariablesText = readRepoFile(SOURCE_INSPECTION_FILES.configVariables);
  results.push({ name: 'config-variables:privacy-defaults', ...checkConfigVariablesPrivacyDefaults(configVariablesText) });
  results.push({ name: 'config-variables:exception-handler-driver-env-only', ...checkExceptionHandlerDriverIsEnvOnly(configVariablesText) });

  const configModuleText = readRepoFile(SOURCE_INSPECTION_FILES.configModule);
  results.push({ name: 'twenty-config-module:database-driver-gated-by-env', ...checkConfigModuleGatesDatabaseDriverByEnv(configModuleText) });

  const configServiceText = readRepoFile(SOURCE_INSPECTION_FILES.configService);
  results.push({ name: 'twenty-config-service:driver-active-from-raw-env', ...checkConfigServiceComputesDriverActiveFromEnv(configServiceText) });
  results.push({ name: 'twenty-config-service:get-skips-db-when-inactive', ...checkConfigServiceSkipsDbWhenInactive(configServiceText) });

  const telemetryServiceText = readRepoFile(SOURCE_INSPECTION_FILES.telemetryService);
  results.push({ name: 'telemetry-service:guards-before-http', ...checkTelemetryServiceGuardsBeforeHttp(telemetryServiceText) });

  const instrumentText = readRepoFile(SOURCE_INSPECTION_FILES.instrument);
  results.push({ name: 'instrument:sentry-gated-by-driver', ...checkInstrumentGatesSentryByDriver(instrumentText) });
  results.push({ name: 'instrument:meter-driver-defaults-empty', ...checkInstrumentMeterDriverDefaultsEmpty(instrumentText) });

  const clientConfigServiceText = readRepoFile(SOURCE_INSPECTION_FILES.clientConfigService);
  results.push({ name: 'client-config:propagates-privacy-flags', ...checkClientConfigPropagatesPrivacyFlags(clientConfigServiceText) });

  const sentryInitEffectText = readRepoFile(SOURCE_INSPECTION_FILES.sentryInitEffect);
  results.push({ name: 'sentry-init-effect:gated-on-dsn', ...checkSentryInitEffectGatedOnDsn(sentryInitEffectText) });

  const enterprisePlanServiceText = readRepoFile(SOURCE_INSPECTION_FILES.enterprisePlanService);
  results.push({ name: 'enterprise-plan-service:no-network-without-key', ...checkEnterpriseServiceNoNetworkWithoutKey(enterprisePlanServiceText) });

  const cronRegisterAllText = readRepoFile(SOURCE_INSPECTION_FILES.cronRegisterAll);
  results.push({ name: 'cron-register-all:marketplace-sync-gated', ...checkMarketplaceCronGatedByConfigFlag(cronRegisterAllText) });

  for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length}/${results.length} privacy checks failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${results.length} privacy checks passed.`);
  console.log('Scope: static contract + source-inspection only. No app was started, no Twenty module was imported/executed, no secret was read. This does NOT prove zero telemetry at runtime or effective values after a real startup -- see docs/aos/bootstrap/TELEMETRY_AUDIT.md and .aos/reports/CRM-003.md for what remains pending in CRM-004/CRM-005.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// self-test: isolated string fixtures only, never this repo's real files.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  function record(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
    } catch (e) {
      console.log(`[FAIL] ${name}: ${e && e.message ? e.message : String(e)}`);
      failures.push(name);
    }
  }
  function assertOk(result, expectedOk) {
    if (result.ok !== expectedOk) {
      throw new Error(`expected ok=${expectedOk}, got ok=${result.ok} (${result.detail})`);
    }
  }

  const GOOD_PRIVACY_ENV = [
    '# comment',
    'TELEMETRY_ENABLED=false',
    'ANALYTICS_ENABLED=false',
    'MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false',
    'IS_CONFIG_VARIABLES_IN_DB_ENABLED=false',
    'EXCEPTION_HANDLER_DRIVER=CONSOLE',
    'LOGIC_FUNCTION_TYPE=DISABLED',
    'CODE_INTERPRETER_TYPE=DISABLED',
    '',
  ].join('\n');
  record('checkPrivacyEnvContract: positive', () => assertOk(checkPrivacyEnvContract(GOOD_PRIVACY_ENV), true));
  record('checkPrivacyEnvContract: missing key is rejected', () => {
    const bad = GOOD_PRIVACY_ENV.replace('TELEMETRY_ENABLED=false\n', '');
    assertOk(checkPrivacyEnvContract(bad), false);
  });
  record('checkPrivacyEnvContract: TELEMETRY_ENABLED=true is rejected (the exact drift this gate exists to catch)', () => {
    const bad = GOOD_PRIVACY_ENV.replace('TELEMETRY_ENABLED=false', 'TELEMETRY_ENABLED=true');
    assertOk(checkPrivacyEnvContract(bad), false);
  });
  record('checkPrivacyEnvContract: a duplicate key keeps the LAST occurrence, matching env_file/dotenv semantics', () => {
    const dup = GOOD_PRIVACY_ENV + '\nTELEMETRY_ENABLED=true\nTELEMETRY_ENABLED=false\n';
    assertOk(checkPrivacyEnvContract(dup), true);
  });

  record('checkPrivacyEnvCarriesNoSecretsOrDsn: positive', () => assertOk(checkPrivacyEnvCarriesNoSecretsOrDsn(GOOD_PRIVACY_ENV), true));
  record('checkPrivacyEnvCarriesNoSecretsOrDsn: a SENTRY_FRONT_DSN entry is rejected even if empty', () => {
    const bad = GOOD_PRIVACY_ENV + '\nSENTRY_FRONT_DSN=\n';
    assertOk(checkPrivacyEnvCarriesNoSecretsOrDsn(bad), false);
  });
  record('checkPrivacyEnvCarriesNoSecretsOrDsn: a *_API_KEY-suffixed key is rejected', () => {
    const bad = GOOD_PRIVACY_ENV + '\nSOME_SERVICE_API_KEY=whatever\n';
    assertOk(checkPrivacyEnvCarriesNoSecretsOrDsn(bad), false);
  });

  const GOOD_CONFIG_VARIABLES = [
    "  TELEMETRY_ENABLED = true;",
    "  ANALYTICS_ENABLED = false;",
    "  MARKETPLACE_CATALOG_SYNC_CRON_ENABLED = true;",
    "  IS_CONFIG_VARIABLES_IN_DB_ENABLED = true;",
    "  @ConfigVariablesMetadata({",
    "    isEnvOnly: true,",
    "  })",
    "  @IsOptional()",
    "  @CastToUpperSnakeCase()",
    "  EXCEPTION_HANDLER_DRIVER: ExceptionHandlerDriver =",
    "    ExceptionHandlerDriver.CONSOLE;",
  ].join('\n');
  record('checkConfigVariablesPrivacyDefaults: positive', () => assertOk(checkConfigVariablesPrivacyDefaults(GOOD_CONFIG_VARIABLES), true));
  record('checkConfigVariablesPrivacyDefaults: a flipped upstream default is caught', () => {
    const bad = GOOD_CONFIG_VARIABLES.replace('ANALYTICS_ENABLED = false;', 'ANALYTICS_ENABLED = true;');
    assertOk(checkConfigVariablesPrivacyDefaults(bad), false);
  });
  record('checkExceptionHandlerDriverIsEnvOnly: positive', () => assertOk(checkExceptionHandlerDriverIsEnvOnly(GOOD_CONFIG_VARIABLES), true));
  record('checkExceptionHandlerDriverIsEnvOnly: a removed isEnvOnly flag is caught (would make EXCEPTION_HANDLER_DRIVER DB-overridable)', () => {
    const bad = GOOD_CONFIG_VARIABLES.replace('    isEnvOnly: true,\n', '');
    assertOk(checkExceptionHandlerDriverIsEnvOnly(bad), false);
  });

  const GOOD_CONFIG_MODULE = [
    'const isConfigVariablesInDbEnabled =',
    "  process.env.IS_CONFIG_VARIABLES_IN_DB_ENABLED !== 'false';",
    'const imports = isConfigVariablesInDbEnabled',
    '  ? [DatabaseConfigModule.forRoot()]',
    '  : [];',
  ].join('\n');
  record('checkConfigModuleGatesDatabaseDriverByEnv: positive', () => assertOk(checkConfigModuleGatesDatabaseDriverByEnv(GOOD_CONFIG_MODULE), true));
  record('checkConfigModuleGatesDatabaseDriverByEnv: an unconditional import is caught', () => {
    const bad = 'const imports = [DatabaseConfigModule.forRoot()];';
    assertOk(checkConfigModuleGatesDatabaseDriverByEnv(bad), false);
  });

  const GOOD_CONFIG_SERVICE = [
    "const isConfigVariablesInDbEnabled = this.environmentConfigDriver.get(",
    "  'IS_CONFIG_VARIABLES_IN_DB_ENABLED',",
    ");",
    "this.isDatabaseDriverActive =",
    "  isConfigVariablesInDbEnabled && !!this.databaseConfigDriver;",
    "",
    "get<T extends keyof ConfigVariables>(key: T): ConfigVariables[T] {",
    "  if (isEnvOnlyConfigVar(key)) {",
    "    return this.environmentConfigDriver.get(key);",
    "  }",
    "  if (this.isDatabaseDriverActive) {",
    "    const cachedValueFromDb = this.databaseConfigDriver.get(key);",
    "    if (cachedValueFromDb !== undefined) {",
    "      return cachedValueFromDb;",
    "    }",
    "  }",
    "  return this.environmentConfigDriver.get(key);",
    "}",
  ].join('\n');
  record('checkConfigServiceComputesDriverActiveFromEnv: positive', () => assertOk(checkConfigServiceComputesDriverActiveFromEnv(GOOD_CONFIG_SERVICE), true));
  record('checkConfigServiceComputesDriverActiveFromEnv: driver active no longer AND-ed with the raw env read is caught', () => {
    const bad = GOOD_CONFIG_SERVICE.replace('isConfigVariablesInDbEnabled && !!this.databaseConfigDriver', '!!this.databaseConfigDriver');
    assertOk(checkConfigServiceComputesDriverActiveFromEnv(bad), false);
  });
  record('checkConfigServiceSkipsDbWhenInactive: positive', () => assertOk(checkConfigServiceSkipsDbWhenInactive(GOOD_CONFIG_SERVICE), true));
  record('checkConfigServiceSkipsDbWhenInactive: an unconditional DB read (the exact regression this guards) is caught', () => {
    const bad = GOOD_CONFIG_SERVICE.replace('if (this.isDatabaseDriverActive) {\n    const cachedValueFromDb', 'if (true) {\n    const cachedValueFromDb');
    assertOk(checkConfigServiceSkipsDbWhenInactive(bad), false);
  });

  const GOOD_TELEMETRY_SERVICE = [
    'async publish(payload) {',
    "  if (!this.twentyConfigService.get('TELEMETRY_ENABLED')) {",
    '    return { success: true };',
    '  }',
    '  const httpClient = this.secureHttpClientService.getHttpClient({ baseURL: "https://twenty-telemetry.com/api/v2" });',
    '  await httpClient.post(`/selfHostingEvent`, {});',
    '}',
  ].join('\n');
  record('checkTelemetryServiceGuardsBeforeHttp: positive', () => assertOk(checkTelemetryServiceGuardsBeforeHttp(GOOD_TELEMETRY_SERVICE), true));
  record('checkTelemetryServiceGuardsBeforeHttp: a guard moved after the HTTP client is caught (the exact bug this exists to catch)', () => {
    const bad = [
      'async publish(payload) {',
      '  const httpClient = this.secureHttpClientService.getHttpClient({ baseURL: "https://twenty-telemetry.com/api/v2" });',
      "  if (!this.twentyConfigService.get('TELEMETRY_ENABLED')) {",
      '    return { success: true };',
      '  }',
      '  await httpClient.post(`/selfHostingEvent`, {});',
      '}',
    ].join('\n');
    assertOk(checkTelemetryServiceGuardsBeforeHttp(bad), false);
  });

  const GOOD_INSTRUMENT = [
    "const meterDrivers = parseArrayEnvVar(",
    "  process.env.METER_DRIVER,",
    "  Object.values(MeterDriver),",
    "  [],",
    ");",
    "if (process.env.EXCEPTION_HANDLER_DRIVER === ExceptionHandlerDriver.SENTRY) {",
    "  Sentry.init({});",
    "}",
  ].join('\n');
  record('checkInstrumentGatesSentryByDriver: positive', () => assertOk(checkInstrumentGatesSentryByDriver(GOOD_INSTRUMENT), true));
  record('checkInstrumentGatesSentryByDriver: an unconditional Sentry.init is caught', () => {
    const bad = 'Sentry.init({});';
    assertOk(checkInstrumentGatesSentryByDriver(bad), false);
  });
  record('checkInstrumentMeterDriverDefaultsEmpty: positive', () => assertOk(checkInstrumentMeterDriverDefaultsEmpty(GOOD_INSTRUMENT), true));
  record('checkInstrumentMeterDriverDefaultsEmpty: a non-empty fallback is caught', () => {
    const bad = GOOD_INSTRUMENT.replace('Object.values(MeterDriver),\n  [],', "Object.values(MeterDriver),\n  ['opentelemetry'],");
    assertOk(checkInstrumentMeterDriverDefaultsEmpty(bad), false);
  });

  const GOOD_CLIENT_CONFIG = [
    'sentry: {',
    "  dsn: this.twentyConfigService.get('SENTRY_FRONT_DSN'),",
    '},',
    "analyticsEnabled: this.twentyConfigService.get('ANALYTICS_ENABLED'),",
  ].join('\n');
  record('checkClientConfigPropagatesPrivacyFlags: positive', () => assertOk(checkClientConfigPropagatesPrivacyFlags(GOOD_CLIENT_CONFIG), true));
  record('checkClientConfigPropagatesPrivacyFlags: analyticsEnabled no longer sourced from config is caught', () => {
    const bad = GOOD_CLIENT_CONFIG.replace("analyticsEnabled: this.twentyConfigService.get('ANALYTICS_ENABLED'),", 'analyticsEnabled: true,');
    assertOk(checkClientConfigPropagatesPrivacyFlags(bad), false);
  });

  const GOOD_SENTRY_INIT_EFFECT = [
    'if (',
    '  isNonEmptyString(sentryConfig?.dsn) &&',
    '  !isSentryInitialized',
    ') {',
    "  const { init } = await import('@sentry/react');",
    '  init({',
    '    dsn: sentryConfig?.dsn,',
    '  });',
    '}',
  ].join('\n');
  record('checkSentryInitEffectGatedOnDsn: positive', () => assertOk(checkSentryInitEffectGatedOnDsn(GOOD_SENTRY_INIT_EFFECT), true));
  record('checkSentryInitEffectGatedOnDsn: an unconditional init is caught', () => {
    const bad = "const { init } = await import('@sentry/react');\ninit({ dsn: sentryConfig?.dsn });";
    assertOk(checkSentryInitEffectGatedOnDsn(bad), false);
  });

  const GOOD_ENTERPRISE_SERVICE = [
    'async refreshValidityToken(): Promise<boolean> {',
    "  const enterpriseKey = this.twentyConfigService.get('ENTERPRISE_KEY');",
    '  if (!enterpriseKey) {',
    '    return false;',
    '  }',
    '  const response = await fetch(validateUrl, {});',
    '  return true;',
    '}',
    '',
    'async reportSeats(seatCount: number): Promise<boolean> {',
    "  const enterpriseKey = this.twentyConfigService.get('ENTERPRISE_KEY');",
    '  if (!enterpriseKey) {',
    '    return false;',
    '  }',
    '  const response = await fetch(seatsUrl, {});',
    '  return true;',
    '}',
  ].join('\n');
  record('checkEnterpriseServiceNoNetworkWithoutKey: positive', () => assertOk(checkEnterpriseServiceNoNetworkWithoutKey(GOOD_ENTERPRISE_SERVICE), true));
  record('checkEnterpriseServiceNoNetworkWithoutKey: reportSeats fetching before the guard is caught', () => {
    const bad = GOOD_ENTERPRISE_SERVICE.replace(
      "async reportSeats(seatCount: number): Promise<boolean> {\n  const enterpriseKey = this.twentyConfigService.get('ENTERPRISE_KEY');\n  if (!enterpriseKey) {\n    return false;\n  }\n  const response = await fetch(seatsUrl, {});",
      "async reportSeats(seatCount: number): Promise<boolean> {\n  const response = await fetch(seatsUrl, {});\n  const enterpriseKey = this.twentyConfigService.get('ENTERPRISE_KEY');\n  if (!enterpriseKey) {\n    return false;\n  }",
    );
    assertOk(checkEnterpriseServiceNoNetworkWithoutKey(bad), false);
  });

  const GOOD_CRON_REGISTER_ALL = [
    'const isMarketplaceCatalogSyncEnabled = this.twentyConfigService.get(',
    "  'MARKETPLACE_CATALOG_SYNC_CRON_ENABLED',",
    ');',
    'const allCommands = [',
    '  {',
    "    name: 'MarketplaceCatalogSync',",
    '    command: this.marketplaceCatalogSyncCronCommand,',
    '    isEnabled: isMarketplaceCatalogSyncEnabled,',
    '  },',
    '];',
    'for (const { name, command, isEnabled = true } of allCommands) {',
    '  if (!isEnabled) {',
    '    continue;',
    '  }',
    '}',
  ].join('\n');
  record('checkMarketplaceCronGatedByConfigFlag: positive', () => assertOk(checkMarketplaceCronGatedByConfigFlag(GOOD_CRON_REGISTER_ALL), true));
  record('checkMarketplaceCronGatedByConfigFlag: the isEnabled attachment removed is caught (the cron would always register)', () => {
    const bad = GOOD_CRON_REGISTER_ALL.replace("    isEnabled: isMarketplaceCatalogSyncEnabled,\n", '');
    assertOk(checkMarketplaceCronGatedByConfigFlag(bad), false);
  });

  console.log(`\nself-test: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  return failures.length === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  main();
}
