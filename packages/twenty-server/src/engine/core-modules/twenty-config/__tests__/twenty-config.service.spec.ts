import type { DatabaseConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/database-config.driver';
import type { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// CRM-003 (AOS-CRM): proves the DB-precedence contract documented in
// docs/aos/bootstrap/TELEMETRY_AUDIT.md -- when IS_CONFIG_VARIABLES_IN_DB_ENABLED
// is false, get() never even calls the database driver (not just "ignores its
// value"), so a value a previous session persisted to core.configVariable
// cannot silently resurface. The second test proves the same database driver
// mock DOES get consulted and DOES win when the flag is true, so the first
// assertion is not vacuously passing. No real DB, no Nest/app bootstrap:
// TwentyConfigService is constructed directly with driver doubles.
describe('TwentyConfigService', () => {
  const buildService = ({
    isConfigVariablesInDbEnabled,
    environmentTelemetryEnabled,
    databaseTelemetryEnabled,
  }: {
    isConfigVariablesInDbEnabled: boolean;
    environmentTelemetryEnabled: boolean;
    databaseTelemetryEnabled: boolean;
  }) => {
    const environmentGet = jest.fn((key: string) => {
      if (key === 'IS_CONFIG_VARIABLES_IN_DB_ENABLED') {
        return isConfigVariablesInDbEnabled;
      }
      if (key === 'TELEMETRY_ENABLED') {
        return environmentTelemetryEnabled;
      }
      throw new Error(`unexpected environment key read in test: ${key}`);
    });
    const databaseGet = jest.fn().mockReturnValue(databaseTelemetryEnabled);

    const environmentConfigDriver = {
      get: environmentGet,
    } as unknown as EnvironmentConfigDriver;
    const databaseConfigDriver = {
      get: databaseGet,
    } as unknown as DatabaseConfigDriver;

    const service = new TwentyConfigService(
      environmentConfigDriver,
      databaseConfigDriver,
    );

    return { service, environmentGet, databaseGet };
  };

  it('falls back to the environment value and never calls the database driver when IS_CONFIG_VARIABLES_IN_DB_ENABLED is false, even with a stale DB override present', () => {
    const { service, databaseGet } = buildService({
      isConfigVariablesInDbEnabled: false,
      environmentTelemetryEnabled: false,
      databaseTelemetryEnabled: true,
    });

    expect(service.get('TELEMETRY_ENABLED')).toBe(false);
    expect(databaseGet).not.toHaveBeenCalled();
  });

  it('sanity check: consults the database driver and returns its override when IS_CONFIG_VARIABLES_IN_DB_ENABLED is true, so the test above is not vacuous', () => {
    const { service, databaseGet } = buildService({
      isConfigVariablesInDbEnabled: true,
      environmentTelemetryEnabled: false,
      databaseTelemetryEnabled: true,
    });

    expect(service.get('TELEMETRY_ENABLED')).toBe(true);
    expect(databaseGet).toHaveBeenCalledWith('TELEMETRY_ENABLED');
  });
});
