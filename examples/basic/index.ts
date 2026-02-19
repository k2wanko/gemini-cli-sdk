import { GeminiAgent, GeminiEventType } from "../../src/index.js";

const agent = new GeminiAgent({
  instructions: "You are a friendly assistant. Keep responses short.",
});

for await (const event of agent.sendStream("Say hello")) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
