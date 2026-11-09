import { ResourceNotFoundException } from '@aws-sdk/client-lambda';

// A tiny in-memory stand-in for the AWS Lambda control plane: enough state
// (functions, layer versions) to make CreateFunction -> GetFunction,
// PublishLayerVersion -> ListLayerVersions, etc. behave consistently across
// calls within one test, without ever touching the network. Every call is
// also recorded in `calls` so tests can assert on exactly what each service
// sent AWS, in order.
export type FakeLambdaCall = { command: string; input: Record<string, any> };

const arnFor = (kind: 'function' | 'layer', name: string): string =>
  `arn:aws:lambda:eu-west-1:123456789012:${kind}:${name}`;

export const createFakeLambdaClient = () => {
  const calls: FakeLambdaCall[] = [];
  const functions = new Map<string, any>();
  const layerVersions = new Map<
    string,
    Array<{ Version: number; LayerVersionArn: string }>
  >();

  const handlers: Record<string, (input: any) => any> = {
    CreateFunctionCommand: (input) => {
      const functionArn = arnFor('function', input.FunctionName);

      functions.set(input.FunctionName, {
        Configuration: {
          FunctionName: input.FunctionName,
          State: 'Active',
          FunctionArn: functionArn,
          Layers: (input.Layers ?? []).map((arn: string) => ({ Arn: arn })),
        },
        Tags: input.Tags ?? {},
      });

      return { FunctionArn: functionArn };
    },
    GetFunctionCommand: (input) => {
      const found = functions.get(input.FunctionName);

      if (!found) {
        throw new ResourceNotFoundException({
          message: `Function not found: ${input.FunctionName}`,
          $metadata: {},
        });
      }

      return found;
    },
    UpdateFunctionCodeCommand: (input) => {
      const found = functions.get(input.FunctionName);
      const functionArn = arnFor('function', input.FunctionName);

      if (found) {
        found.Configuration.FunctionArn = functionArn;
      }

      return { FunctionArn: functionArn };
    },
    UpdateFunctionConfigurationCommand: (input) => {
      const found = functions.get(input.FunctionName);

      if (found) {
        found.Configuration.Layers = (input.Layers ?? []).map(
          (arn: string) => ({ Arn: arn }),
        );
      }

      return {};
    },
    DeleteFunctionCommand: (input) => {
      functions.delete(input.FunctionName);

      return {};
    },
    TagResourceCommand: (input) => {
      for (const found of functions.values()) {
        if (found.Configuration.FunctionArn === input.Resource) {
          found.Tags = { ...found.Tags, ...input.Tags };
        }
      }

      return {};
    },
    PublishLayerVersionCommand: (input) => {
      const existing = layerVersions.get(input.LayerName) ?? [];
      const version = existing.length + 1;
      const layerVersionArn = `${arnFor('layer', input.LayerName)}:${version}`;

      existing.push({ Version: version, LayerVersionArn: layerVersionArn });
      layerVersions.set(input.LayerName, existing);

      return { LayerVersionArn: layerVersionArn };
    },
    ListLayerVersionsCommand: (input) => {
      const existing = layerVersions.get(input.LayerName) ?? [];

      return { LayerVersions: [...existing].reverse() };
    },
    DeleteLayerVersionCommand: (input) => {
      const existing = layerVersions.get(input.LayerName) ?? [];

      layerVersions.set(
        input.LayerName,
        existing.filter((v) => v.Version !== input.VersionNumber),
      );

      return {};
    },
    InvokeCommand: (input) => ({
      Payload: Buffer.from(JSON.stringify({ echoed: input.Payload ?? null })),
    }),
  };

  const send = jest.fn(async (command: any) => {
    const name = command.constructor.name;

    calls.push({ command: name, input: { ...command.input } });

    const handler = handlers[name];

    if (!handler) {
      throw new Error(`fake-lambda-client: no handler for ${name}`);
    }

    return handler(command.input);
  });

  return {
    client: { send, middlewareStack: { add: jest.fn() } },
    calls,
    functions,
    layerVersions,
  };
};

export const callsNamed = (calls: FakeLambdaCall[], command: string) =>
  calls.filter((call) => call.command === command);
