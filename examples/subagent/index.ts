/**
 * Programmatic sub-agent example using defineSubAgent().
 *
 * Usage:
 *   bun examples/subagent/index.ts
 */
import {
  GeminiAgent,
  GeminiEventType,
  defineSubAgent,
  z,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Define a translation sub-agent
// ---------------------------------------------------------------------------
const translate = defineSubAgent({
  name: "translate",
  description: "Translate text into a target language",
  inputSchema: z.object({
    text: z.string().describe("Text to translate"),
    targetLang: z.string().describe("Target language"),
  }),
  systemPrompt:
    "You are a professional translator.\nTranslate into ${targetLang}.\nOutput ONLY the translated text.",
  query: "${text}",
});

// ---------------------------------------------------------------------------
// Create parent agent with the sub-agent tool
// ---------------------------------------------------------------------------
const agent = new GeminiAgent({
  instructions:
    "You are a multilingual assistant. When the user asks to translate something, use the translate tool. Show the original text and the translation result.",
  tools: [translate],
});

console.log("=== Programmatic sub-agent example ===\n");

for await (const event of agent.sendStream(
  "Translate 'Hello, how are you?' into Japanese",
)) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
