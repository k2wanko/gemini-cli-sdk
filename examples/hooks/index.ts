import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  GeminiAgent,
  GeminiEventType,
  HookEventName,
  HookType,
  defineTool,
} from "../../src/index.js";

const hookScript = new URL("hooks/log-tool.sh", import.meta.url).pathname;
const hookLog = new URL("hook.log", import.meta.url).pathname;

const greet = defineTool(
  {
    name: "greet",
    description: "Greet a person by name",
    inputSchema: z.object({ name: z.string() }),
  },
  async (params) => `Hello, ${params.name}!`,
);

const agent = new GeminiAgent({
  instructions:
    "You are a helpful assistant. Always use the greet tool when asked to greet someone.",
  tools: [greet],
  hooks: {
    [HookEventName.BeforeTool]: [
      {
        matcher: ".*",
        hooks: [{ type: HookType.Command, command: hookScript }],
      },
    ],
    [HookEventName.AfterTool]: [
      {
        matcher: ".*",
        hooks: [{ type: HookType.Command, command: hookScript }],
      },
    ],
  },
});

for await (const event of agent.sendStream("Please greet Alice")) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");

// Show hook log
try {
  const log = readFileSync(hookLog, "utf-8");
  console.log("\n--- Hook log ---");
  console.log(log.trimEnd());
} catch {
  console.log("\n(No hook log generated — tool may not have been called)");
}
