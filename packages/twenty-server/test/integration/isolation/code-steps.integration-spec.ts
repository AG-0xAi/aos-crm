import { randomUUID } from 'node:crypto';

import { createOneLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/create-logic-function.util';
import { deleteLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/delete-logic-function.util';
import { executeLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/execute-logic-function.util';
import { findOneLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/find-one-logic-function.util';
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
      input: { name: `isolationLogicFunction${MARKER.replace(/-/g, '')}` },
      expectToFail: false,
    });

    logicFunctionId = data.createOneLogicFunction.id;
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
      await findOneLogicFunction({
        input: { id: logicFunctionId },
        expectToFail: true,
        token,
      });
    }
  });

  it("YCombinator's credentials cannot invoke Apple's logic function by id, and Apple's own token can", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      await executeLogicFunction({
        input: { id: logicFunctionId, payload: {} },
        expectToFail: true,
        token,
      });
    }

    const stillOwned = await findOneLogicFunction({
      input: { id: logicFunctionId },
      expectToFail: false,
    });

    expect(stillOwned.data.findOneLogicFunction?.id).toBe(logicFunctionId);
  });
});
