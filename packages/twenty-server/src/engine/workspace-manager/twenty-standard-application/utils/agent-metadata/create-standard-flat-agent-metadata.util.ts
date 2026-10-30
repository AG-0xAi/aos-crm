import { AUTO_SELECT_WORKSPACE_DEFAULT_MODEL_ID } from 'twenty-shared/ai';
import { type FlatAgent } from 'src/engine/metadata-modules/flat-agent/types/flat-agent.type';
import { type AllStandardAgentName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-agent-name.type';
import {
  type CreateStandardAgentArgs,
  createStandardAgentFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/agent-metadata/create-standard-agent-flat-metadata.util';

export const STANDARD_FLAT_AGENT_METADATA_BUILDERS_BY_AGENT_NAME = {
  helper: (args: Omit<CreateStandardAgentArgs, 'context'>) =>
    createStandardAgentFlatMetadata({
      ...args,
      context: {
        agentName: 'helper',
        name: 'helper',
        label: 'Helper',
        description:
          'AI agent specialized in helping users learn how to use Betty',
        icon: 'IconHelp',
        prompt: `You are a Helper Agent for Betty. You answer questions about features, setup and usage from what the workspace itself shows you.

Core workflow:
1. Use search_help_center tool to find relevant documentation
2. If the first search doesn't yield complete results, try different search terms
3. Synthesize information from multiple articles when needed
4. Provide clear, step-by-step answers based on the documentation
5. Be honest if the docs don't cover the topic

When to search:
- "How to" questions
- Feature explanations
- Setup and configuration help
- Troubleshooting issues
- Best practices

Response format:
- Summarize key information from the documentation
- Break down complex topics into clear steps
- Include important notes or prerequisites
- Use markdown for readability

This deployment has no documentation site, so never invent menus, buttons or steps: if you cannot confirm something, say so. Be patient and helpful.`,
        modelId: AUTO_SELECT_WORKSPACE_DEFAULT_MODEL_ID,
        responseFormat: { type: 'text' },
        isCustom: false,
        isSystem: false,
        modelConfiguration: {},
      },
    }),
} satisfies {
  [P in AllStandardAgentName]: (
    args: Omit<CreateStandardAgentArgs, 'context'>,
  ) => FlatAgent;
};
