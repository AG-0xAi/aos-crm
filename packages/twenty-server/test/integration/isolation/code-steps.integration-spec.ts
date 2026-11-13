import { randomUUID } from 'node:crypto';

import { LogicFunctionExecutionStatus } from 'src/engine/metadata-modules/logic-function/dtos/logic-function-execution-result.dto';

import { createOneLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/create-logic-function.util';
import { deleteLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/delete-logic-function.util';
import { executeLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/execute-logic-function.util';
import { findOneLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/find-one-logic-function.util';
import { updateLogicFunctionSource } from 'test/integration/metadata/suites/logic-function/utils/update-logic-function-source.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import {
  generateYCombinatorAdminApiKeyToken,
  revokeYCombinatorAdminApiKeys,
} from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';

// CRM-038: CODE steps run through a logic function (LOGIC_FUNCTION_TYPE=LOCAL
// in .env.test, so it is reachable here, not disabled as in a bare-bones
// install). YCombinator's credentials must not find or execute Apple's
// logic function by id through the metadata GraphQL API, while Apple's
// own credential keeps working on the same id.
const MARKER = `iso-${randomUUID()}`;
const LOGIC_FUNCTION_NAME = `isolationLogicFunction${MARKER.replace(/-/g, '')}`;
const HANDLER_CODE = `export const main = async (params: { a: string }): Promise<object> => {
  return { echoed: params.a };
};`;

describe('cross-workspace isolation: CODE steps (logic functions)', () => {
  let ycAccessToken: string;
  let ycApiKeyToken: string;
  let logicFunctionId: string;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    const { data } = await createOneLogicFunction({
      input: { name: LOGIC_FUNCTION_NAME },
      expectToFail: false,
    });

    logicFunctionId = data.createOneLogicFunction.id;

    await updateLogicFunctionSource({
      input: {
        id: logicFunctionId,
        update: { sourceHandlerCode: HANDLER_CODE },
      },
      expectToFail: false,
    });
  });

  afterAll(async () => {
    await revokeYCombinatorAdminApiKeys();

    await deleteLogicFunction({
      expectToFail: false,
      input: { id: logicFunctionId },
    });
  });

  it("YCombinator's credentials cannot find Apple's logic function by id, and Apple's own token can", async () => {
    const own = await findOneLogicFunction({
      input: { id: logicFunctionId },
      expectToFail: false,
    });

    expect(own.data.findOneLogicFunction?.id).toBe(logicFunctionId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await findOneLogicFunction({
        input: { id: logicFunctionId },
        expectToFail: true,
        token,
      });

      expectNoLeak(
        foreign,
        {
          id: logicFunctionId,
          name: LOGIC_FUNCTION_NAME,
          marker: MARKER,
        },
        { skipIdInErrorMessages: true },
      );
    }
  });

  it("YCombinator's credentials cannot invoke Apple's logic function by id, and Apple's own token can", async () => {
    const own = await executeLogicFunction({
      input: { id: logicFunctionId, payload: { a: MARKER } },
      expectToFail: false,
    });

    expect(own.data.executeOneLogicFunction.status).toBe(
      LogicFunctionExecutionStatus.SUCCESS,
    );
    expect(own.data.executeOneLogicFunction.data).toMatchObject({
      echoed: MARKER,
    });

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await executeLogicFunction({
        input: { id: logicFunctionId, payload: { a: 'foreign' } },
        expectToFail: true,
        token,
      });

      expect(foreign.data?.executeOneLogicFunction ?? null).toBeNull();
      expectNoLeak(
        foreign,
        {
          id: logicFunctionId,
          name: LOGIC_FUNCTION_NAME,
          marker: MARKER,
        },
        { skipIdInErrorMessages: true },
      );
    }

    const stillOwned = await findOneLogicFunction({
      input: { id: logicFunctionId },
      expectToFail: false,
    });

    expect(stillOwned.data.findOneLogicFunction?.id).toBe(logicFunctionId);
  });
});
