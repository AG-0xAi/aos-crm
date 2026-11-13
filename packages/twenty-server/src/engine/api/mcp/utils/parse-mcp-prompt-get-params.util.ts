import { z } from 'zod';

const mcpPromptGetParamsSchema = z.object({
  name: z.string().min(1),
});

export const parseMcpPromptGetParams = (
  params: Record<string, unknown> | undefined,
): string | undefined => {
  const parsed = mcpPromptGetParamsSchema.safeParse(params);

  return parsed.success ? parsed.data.name : undefined;
};
