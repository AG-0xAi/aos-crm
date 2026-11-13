export type McpPromptGetResult = {
  description: string;
  messages: {
    role: 'user';
    content: { type: 'text'; text: string };
  }[];
};
