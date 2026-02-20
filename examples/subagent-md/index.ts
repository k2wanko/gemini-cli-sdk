/**
 * File-based sub-agent example using loadSubAgents().
 *
 * Demonstrates both local and remote agents loaded from markdown files:
 *   - translator.md   — local sub-agent (Gemini-powered translation)
 *   - echo-upper.md   — remote sub-agent (A2A protocol, local server)
 *
 * The example starts a local A2A echo server on port 51898, then loads
 * all agent definitions from the agents/ directory.
 *
 * Usage:
 *   bun examples/subagent-md/index.ts
 */
import {
  GeminiAgent,
  GeminiEventType,
  loadSubAgents,
} from "../../src/index.js";
import { startA2AServer } from "./server.js";

const agentsDir = new URL("agents", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// 1. Start a local A2A echo server (echoes input in UPPER CASE)
// ---------------------------------------------------------------------------
const server = await startA2AServer(51898);
console.log(`A2A echo server listening on port ${server.port}\n`);

try {
  // ---------------------------------------------------------------------------
  // 2. Load all sub-agents from the agents/ directory
  // ---------------------------------------------------------------------------
  const agents = await loadSubAgents(agentsDir);
  console.log(
    `Loaded ${agents.length} agent(s): ${agents.map((a) => a.name).join(", ")}\n`,
  );

  // ---------------------------------------------------------------------------
  // 3. Create the parent agent and run
  // ---------------------------------------------------------------------------
  const agent = new GeminiAgent({
    instructions: [
      "You are a multilingual assistant with two tools:",
      "- translator: translates text into a target language",
      "- echo-upper: converts text to upper case via a remote A2A agent",
      "Use the appropriate tool based on the user's request.",
    ].join("\n"),
    tools: agents,
  });

  console.log("=== File-based sub-agent example ===\n");

  for await (const event of agent.sendStream(
    "Please convert 'hello world' to uppercase using the echo-upper tool.",
  )) {
    if (event.type === GeminiEventType.Content) {
      process.stdout.write(String(event.value));
    }
  }
  process.stdout.write("\n");
} finally {
  await server.close();
}
