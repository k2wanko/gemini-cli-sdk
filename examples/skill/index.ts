import { GeminiAgent, GeminiEventType, skillDir } from "../../src/index.js";

const agent = new GeminiAgent({
  instructions: "You are a browser automation assistant.",
  skills: [
    skillDir(new URL("skills", import.meta.url).pathname),
  ],
});

for await (const event of agent.sendStream(
  "Take a screenshot of https://example.com",
)) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
