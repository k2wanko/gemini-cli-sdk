# @k2wanko/gemini-cli-sdk

A lightweight, type-safe SDK for building non-interactive AI agents powered by Google Gemini.
Built on top of `@google/gemini-cli-core`.

## Features

- **Sub-agents** — Delegate tasks to specialized child agents via `defineSubAgent()` (programmatic) or `loadSubAgents()` (markdown files), supporting both local Gemini agents and remote A2A protocol agents
- **Skill support** — Load skill directories compatible with Gemini CLI's skill format
- **Non-interactive by default** — All tool calls are auto-approved, designed for headless agent usage
- **Logging control** — Suppress noisy core logs by default (`"silent"`), or route them to a custom logger (pino, winston, etc.) via `logLevel` and `logger` options
- **Hooks** — Run shell commands at lifecycle events (BeforeTool, AfterTool, BeforeAgent, etc.) to inject context, block operations, or audit tool calls — compatible with Gemini CLI's hook protocol

## Install

```bash
npm install @k2wanko/gemini-cli-sdk
```

## Quick Start

```ts
import { GeminiAgent, GeminiEventType } from "@k2wanko/gemini-cli-sdk";

const agent = new GeminiAgent({
  instructions: "You are a friendly assistant. Keep responses short.",
});

for await (const event of agent.sendStream("Say hello")) {
  if (event.type === GeminiEventType.Content) {
    process.stdout.write(String(event.value));
  }
}
```

## Defining Custom Tools

```ts
import { GeminiAgent, defineTool, z } from "@k2wanko/gemini-cli-sdk";

const fetchUrl = defineTool(
  {
    name: "fetch_url",
    description: "Fetch the content of a URL",
    inputSchema: z.object({
      url: z.string().url(),
    }),
  },
  async (params) => {
    const res = await fetch(params.url);
    return res.text();
  },
);

const agent = new GeminiAgent({
  instructions: "You are a web research assistant.",
  tools: [fetchUrl],
});
```

## Using Skills

Load skill directories to give the agent additional capabilities:

```ts
import { GeminiAgent, GeminiEventType, skillDir } from "@k2wanko/gemini-cli-sdk";

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
```

See [`examples/`](./examples/) for runnable samples.

## Authentication

This SDK uses the same authentication as `@google/gemini-cli-core`. Set up credentials via one of:

- **Google Cloud ADC** (default): `gcloud auth application-default login`
- **API Key**: Set `GEMINI_API_KEY` environment variable

## License

MIT
