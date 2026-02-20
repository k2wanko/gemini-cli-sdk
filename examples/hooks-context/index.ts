import { z } from "zod";
import {
  GeminiAgent,
  GeminiEventType,
  HookEventName,
  defineTool,
} from "../../src/index.js";

const contextHook = new URL("hooks/inject-context.sh", import.meta.url).pathname;

const lookupUser = defineTool(
  {
    name: "lookup_user",
    description: "Look up a user by ID and return their profile",
    inputSchema: z.object({ userId: z.string() }),
  },
  async (params) => ({
    userId: params.userId,
    name: "Alice",
    email: "alice@example.com",
    role: "admin",
  }),
);

const agent = new GeminiAgent({
  instructions:
    "You are a helpful assistant. Use the lookup_user tool when asked about a user. Report the result faithfully, including any policy notices you receive.",
  tools: [lookupUser],
  hooks: {
    [HookEventName.AfterTool]: [
      {
        matcher: ".*",
        hooks: [{ type: "command" as const, command: contextHook }],
      },
    ],
  },
});

console.log("=== AfterTool context injection test ===");
console.log("Expected: model mentions that data is from staging environment\n");

for await (const event of agent.sendStream("Look up user ID u-42")) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
