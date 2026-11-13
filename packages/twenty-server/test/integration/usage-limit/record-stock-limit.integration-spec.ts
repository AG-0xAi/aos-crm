import { createManyOperationFactory } from 'test/integration/graphql/utils/create-many-operation-factory.util';
import { deleteManyOperationFactory } from 'test/integration/graphql/utils/delete-many-operation-factory.util';
import { destroyManyOperationFactory } from 'test/integration/graphql/utils/destroy-many-operation-factory.util';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { getCoreRepository } from 'test/integration/utils/get-core-repository.util';

import { createClient } from 'redis';
import { type Repository } from 'typeorm';
import { v4 } from 'uuid';

import { RECORD_STOCK_TRACKED_SYSTEM_OBJECT_UNIVERSAL_IDENTIFIERS } from 'src/engine/core-modules/usage-limit/constants/record-stock-tracked-system-object-universal-identifiers.constant';
import { UsageLimitEntity } from 'src/engine/core-modules/usage-limit/usage-limit.entity';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { UsageResourceType } from 'src/engine/core-modules/usage/enums/usage-resource-type.enum';
import { UsageUnit } from 'src/engine/core-modules/usage/enums/usage-unit.enum';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const SCHEMA_NAME = getWorkspaceSchemaName(SEED_APPLE_WORKSPACE_ID);
const HEADROOM = 2;
const STATS_QUIET_WINDOW_MS = 12_000;
const STATS_SETTLE_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = STATS_SETTLE_TIMEOUT_MS + 15_000;

describe('Record stock limit', () => {
  let usageLimitRepository: Repository<UsageLimitEntity>;
  let redis: Awaited<ReturnType<typeof createClient>>;
  let usageLimitId: string;
  let baselineRecordCount: number;
  const createdRocketIds: string[] = [];

  const createRockets = async (count: number) => {
    const ids = Array.from({ length: count }, () => v4());

    createdRocketIds.push(...ids);

    return makeGraphqlApiRequest(
      createManyOperationFactory({
        objectMetadataSingularName: 'rocket',
        objectMetadataPluralName: 'rockets',
        gqlFields: 'id',
        data: ids.map((id) => ({ id, name: 'Record stock test' })),
      }),
    );
  };

  const softDeleteRockets = (ids: string[]) =>
    makeGraphqlApiRequest(
      deleteManyOperationFactory({
        objectMetadataSingularName: 'rocket',
        objectMetadataPluralName: 'rockets',
        gqlFields: 'id',
        filter: { id: { in: ids } },
      }),
    );

  const destroyRockets = (ids: string[]) =>
    makeGraphqlApiRequest(
      destroyManyOperationFactory({
        objectMetadataSingularName: 'rocket',
        objectMetadataPluralName: 'rockets',
        gqlFields: 'id',
        filter: { id: { in: ids } },
      }),
    );

  const findTrackedTableNames = async (): Promise<string[]> => {
    const rows: { nameSingular: string; isCustom: boolean }[] =
      await global.testDataSource.query(
        `SELECT "nameSingular", "applicationId" <> (
           SELECT "applicationId" FROM core."objectMetadata"
           WHERE "workspaceId" = $1 AND "nameSingular" = 'person'
         ) AS "isCustom"
         FROM core."objectMetadata"
         WHERE "workspaceId" = $1
           AND (NOT "isSystem" OR "universalIdentifier" = ANY($2))`,
        [
          SEED_APPLE_WORKSPACE_ID,
          RECORD_STOCK_TRACKED_SYSTEM_OBJECT_UNIVERSAL_IDENTIFIERS,
        ],
      );

    return rows.map(({ nameSingular, isCustom }) =>
      isCustom ? `_${nameSingular}` : nameSingular,
    );
  };

  const countRecords = async (): Promise<number> => {
    const [row]: { quantity: string }[] = await global.testDataSource.query(
      `SELECT COALESCE(SUM(n_live_tup), 0)::bigint AS quantity
       FROM pg_stat_user_tables
       WHERE schemaname = $1 AND relname = ANY($2)`,
      [SCHEMA_NAME, await findTrackedTableNames()],
    );

    return Number(row.quantity);
  };

  const waitForStatsToSettle = async (): Promise<number> => {
    const startedAt = Date.now();
    let current = await countRecords();
    let stableSince = Date.now();

    while (Date.now() - stableSince < STATS_QUIET_WINDOW_MS) {
      if (Date.now() - startedAt > STATS_SETTLE_TIMEOUT_MS) {
        throw new Error(
          `Record statistics did not settle within ${STATS_SETTLE_TIMEOUT_MS} ms (last count ${current})`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));

      const next = await countRecords();

      if (next !== current) {
        current = next;
        stableSince = Date.now();
      }
    }

    return current;
  };

  const dropKeys = async (pattern: string) => {
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(keys);
    }
  };

  const dropStockCounter = () =>
    dropKeys(`*{${SEED_APPLE_WORKSPACE_ID}}:stock-held:RECORD:*`);

  const refreshUsageLimitsCache = () =>
    getAppProviderByClassName<WorkspaceCacheService>(
      'WorkspaceCacheService',
    ).invalidateAndRecompute(SEED_APPLE_WORKSPACE_ID, ['usageLimits']);

  const expectRefused = (response: { body: { errors?: unknown[] } }) => {
    expect(
      (response.body.errors?.[0] as { extensions?: { subCode?: string } })
        ?.extensions?.subCode,
    ).toBe('STOCK_EXHAUSTED');
  };

  const expectAdmitted = (response: { body: { errors?: unknown[] } }) => {
    expect(response.body.errors).toBeUndefined();
  };

  const deleteRecordLimits = () =>
    usageLimitRepository.delete({
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      resourceType: UsageResourceType.RECORD,
    });

  beforeAll(async () => {
    usageLimitRepository =
      getCoreRepository<UsageLimitEntity>(UsageLimitEntity);
    redis = await createClient({ url: process.env.REDIS_URL }).connect();
  });

  beforeEach(async () => {
    await deleteRecordLimits();
    await refreshUsageLimitsCache();

    baselineRecordCount = await waitForStatsToSettle();

    const [usageLimit] = await usageLimitRepository.save([
      {
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        resourceType: UsageResourceType.RECORD,
        operationType: UsageOperationType.RECORD_WRITE,
        spenderType: 'workspace',
        spenderId: '',
        limitKind: 'stock',
        periodCount: 1,
        periodUnit: 'lifetime',
        unit: UsageUnit.RECORD,
        limitValue: baselineRecordCount + HEADROOM,
        burstValue: null,
      },
    ]);

    usageLimitId = usageLimit.id;

    await refreshUsageLimitsCache();
    await dropStockCounter();
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    if (createdRocketIds.length > 0) {
      await global.testDataSource.query(
        `DELETE FROM "${SCHEMA_NAME}"."_rocket" WHERE id = ANY($1)`,
        [createdRocketIds],
      );
      createdRocketIds.length = 0;
    }
  });

  afterAll(async () => {
    await deleteRecordLimits();
    await refreshUsageLimitsCache();
    await dropStockCounter();
    await redis.quit();
  });

  it('refuses the write that would cross the limit', async () => {
    expectAdmitted(await createRockets(HEADROOM));
    expectRefused(await createRockets(1));
  });

  it('refuses a batch as a whole when only part of it fits', async () => {
    expectRefused(await createRockets(HEADROOM + 1));
    expectAdmitted(await createRockets(HEADROOM));
  });

  it('gives the capacity back when records are destroyed', async () => {
    const admitted = await createRockets(HEADROOM);

    expectAdmitted(admitted);
    expectRefused(await createRockets(1));

    await destroyRockets([admitted.body.data.createRockets[0].id]);

    expectAdmitted(await createRockets(1));
  });

  it('keeps soft-deleted records counted until they are destroyed', async () => {
    const admitted = await createRockets(HEADROOM);

    expectAdmitted(admitted);

    await softDeleteRockets([admitted.body.data.createRockets[0].id]);

    expectRefused(await createRockets(1));
  });
});
