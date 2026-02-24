import { z } from "zod";
import {
  createCodeModeTool,
  defineTool,
  GeminiAgent,
  GeminiEventType,
} from "../../src/index.js";

// Tool: add two numbers
const addTool = defineTool(
  {
    name: "add",
    description: "Add two numbers together",
    inputSchema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  },
  async ({ a, b }) => {
    return a + b;
  },
);

// Tool: repeat a string N times
const repeatTool = defineTool(
  {
    name: "repeat",
    description: "Repeat a string a given number of times",
    inputSchema: z.object({
      text: z.string().describe("Text to repeat"),
      times: z.number().describe("Number of repetitions"),
    }),
  },
  async ({ text, times }) => {
    return text.repeat(times);
  },
);

// Wrap both tools into a single CodeMode tool
const codeModeTool = createCodeModeTool({
  tools: [addTool, repeatTool],
});

// console.log("codeModeTool description:\n", codeModeTool);

const agent = new GeminiAgent({
  logLevel: "debug",
  instructions:
    "You are a helpful assistant. Use the code tool to perform calculations and text operations.",
  tools: [codeModeTool],
});

for await (const event of agent.sendStream(
  "Add 7 and 13, then repeat the word 'hello' that many times.",
)) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
process.stdout.write("\n");
