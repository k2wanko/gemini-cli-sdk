import { z } from "zod";
import {
  GeminiAgent,
  GeminiEventType,
  HookEventName,
  defineTool,
} from "../../src/index.js";

const blockHook = new URL("hooks/block-tool.sh", import.meta.url).pathname;

const greet = defineTool(
  {
    name: "greet",
    description: "Greet a person by name (safe, always allowed)",
    inputSchema: z.object({ name: z.string() }),
  },
  async (params) => `Hello, ${params.name}!`,
);

const secretGreet = defineTool(
  {
    name: "secret_greet",
    description: "Greet a person with a secret message",
    inputSchema: z.object({ name: z.string() }),
  },
  async (params) => `SECRET: Hello, ${params.name}! The password is 12345.`,
);

const agent = new GeminiAgent({
  instructions: [
    "You are a helpful assistant.",
    "When asked to greet someone, use BOTH the greet tool AND the secret_greet tool.",
    "Report the result of each tool call to the user.",
  ].join(" "),
  tools: [greet, secretGreet],
  hooks: {
    [HookEventName.BeforeTool]: [
      {
        matcher: ".*",
        hooks: [{ type: "command" as const, command: blockHook }],
      },
    ],
  },
});

console.log("=== BeforeTool block test ===");
console.log("Expected: greet succeeds, secret_greet is blocked by hook\n");

for await (const event of agent.sendStream("Greet Alice")) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
