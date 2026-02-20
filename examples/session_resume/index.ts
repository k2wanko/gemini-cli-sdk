import {
  GeminiAgent,
  GeminiEventType,
  listSessions,
} from "../../src/index.js";
import { Config, getAuthTypeFromEnv, AuthType } from "@google/gemini-cli-core";

// Helper to collect text from a stream
async function collectText(
  stream: AsyncGenerator<{ type: string; value: unknown }>,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type === GeminiEventType.Content) {
      text += String(event.value);
    }
  }
  return text;
}

// --- Step 1: Create an agent and send an initial message ---
console.log("=== Step 1: Initial session ===");
const agent1 = new GeminiAgent({
  instructions: "You are a helpful assistant. Remember any facts the user tells you.",
});

const response1 = await collectText(
  agent1.sendStream("My favorite color is blue. Remember that."),
);
console.log("Agent:", response1);

// --- Step 2: List sessions to find the one we just created ---
console.log("\n=== Step 2: List sessions ===");
// Create a temporary Config to access storage
const tmpConfig = new Config({
  sessionId: "tmp",
  targetDir: process.cwd(),
  cwd: process.cwd(),
  debugMode: false,
  model: "gemini-2.0-flash",
  userMemory: "",
  enableHooks: false,
  mcpEnabled: false,
  extensionsEnabled: false,
});
const authType = getAuthTypeFromEnv() || AuthType.COMPUTE_ADC;
await tmpConfig.refreshAuth(authType);
await tmpConfig.initialize();

const sessions = await listSessions(tmpConfig);
if (sessions.length === 0) {
  console.log("No sessions found. Exiting.");
  process.exit(1);
}

const latestSession = sessions[0]!;
console.log(
  `Found session: ${latestSession.sessionId} (${latestSession.messageCount} messages)`,
);

// --- Step 3: Resume the session with a new agent instance ---
console.log("\n=== Step 3: Resume session ===");
const agent2 = new GeminiAgent({
  instructions: "You are a helpful assistant. Remember any facts the user tells you.",
  sessionId: latestSession.sessionId,
});

const response2 = await collectText(
  agent2.sendStream("What is my favorite color?"),
);
console.log("Agent:", response2);
