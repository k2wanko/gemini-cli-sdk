# @k2wanko/gemini-cli-sdk — Design Document

## Overview

A lightweight, type-safe SDK for building non-interactive AI agents powered by Google Gemini.
Built on top of `@google/gemini-cli-core` but provides its own public API surface designed
for programmatic, headless agent usage.

## Design Philosophy

1. **Type-safe tools via Zod** — Tool parameters are defined with Zod schemas and
   automatically converted to JSON Schema for the Gemini API. Tool actions receive
   fully typed, validated parameters.

2. **Minimal surface area** — The SDK exposes only what agent authors need:
   `GeminiAgent`, `defineTool()`, `SessionContext` interfaces, and `skillDir()`.
   Internal wiring (`Config`, `ToolRegistry`, `MessageBus`, etc.) stays hidden.

3. **Non-interactive by default** — All tool calls are auto-approved via
   `PolicyDecision.ALLOW`. There is no interactive confirmation flow.

4. **Dynamic system instructions** — Instructions can be a static string or an
   async function receiving `SessionContext`, enabling runtime-generated prompts.

5. **Composable context** — Each tool invocation receives a `SessionContext` with
   filesystem, shell, and transcript access, so tools can interact with the host
   environment safely.

## Relationship with `@google/gemini-cli-core`

This SDK is a **consumer** of `@google/gemini-cli-core`. It uses the core package
for authentication, model communication, tool scheduling, shell execution, and
skill loading. However, it does **not** re-export core types directly. The public
API is intentionally decoupled so that core internals can change without breaking
SDK users.

Key core dependencies:

| Core export              | Used by      | Purpose                                |
| ------------------------ | ------------ | -------------------------------------- |
| `Config`                 | `agent.ts`   | Authentication, tool registry, client  |
| `GeminiClient`           | `agent.ts`   | Streaming message exchange             |
| `scheduleAgentTools`     | `agent.ts`   | Parallel tool call execution           |
| `BaseDeclarativeTool`    | `tool.ts`    | Base class for `SdkTool`               |
| `BaseToolInvocation`     | `tool.ts`    | Base class for `SdkToolInvocation`     |
| `ShellTool`              | `context.ts` | Policy check before shell execution    |
| `ShellExecutionService`  | `context.ts` | Actual command execution               |
| `ActivateSkillTool`      | `agent.ts`   | Skill activation support               |
| `loadSkillsFromDir`      | `agent.ts`   | Discover skills from directories       |
| `SESSION_FILE_PREFIX`    | `session.ts` | Session file naming convention         |
| `ConversationRecord`     | `session.ts` | Stored conversation format             |
| `MessageRecord`          | `session.ts` | Individual message in a conversation   |
| `ResumedSessionData`     | `session.ts` | Data passed to `resumeChat()`          |

## Public API

### `GeminiAgent` (agent.ts)

```ts
class GeminiAgent {
  constructor(options: GeminiAgentOptions)
  sendStream(prompt: string, signal?: AbortSignal): AsyncGenerator<ServerGeminiStreamEvent>
  getSessionId(): string
  listSessions(): Promise<SessionInfo[]>
}

interface GeminiAgentOptions {
  instructions: string | ((ctx: SessionContext) => string | Promise<string>)
  tools?: ToolDef<any>[]
  skills?: SkillRef[]
  model?: string
  cwd?: string
  debug?: boolean
  sessionId?: string            // Resume a previous session by ID
  compressionThreshold?: number // Context compression threshold (0-1)
  logLevel?: LogLevel           // Core logger verbosity (default: "silent")
  logger?: Logger               // Custom log destination (default: console)
}
```

### `defineTool()` (tool.ts)

```ts
function defineTool<T extends z.ZodTypeAny>(
  config: { name, description, inputSchema, sendErrorsToModel? },
  action: ToolAction<T>,
): ToolDef<T>

type ToolAction<T> = (params: z.infer<T>, context: SessionContext) => Promise<unknown>

class ToolError extends Error   // throw inside action to send error to model
```

### `SessionContext` (context.ts)

```ts
interface SessionContext {
  sessionId: string
  cwd: string
  transcript: Content[]
  timestamp: string
  fs: AgentFs
  shell: AgentShell
  agent: GeminiAgent
}

interface AgentFs {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<void>
}

interface AgentShell {
  exec(cmd: string, options?: ShellOptions): Promise<ShellResult>
}
```

### Session Resume & Context Compression (session.ts)

```ts
interface SessionInfo {
  sessionId: string
  filePath: string
  startTime: string
  lastUpdated: string
  messageCount: number
  summary?: string
}

// List available sessions for the current project
function listSessions(config: Config): Promise<SessionInfo[]>

// Load a session file into ResumedSessionData
function loadSession(filePath: string): Promise<ResumedSessionData>

// Convert MessageRecord[] to Content[] for API history reconstruction
function messageRecordsToHistory(messages: MessageRecord[]): Content[]
```

**Session Resume** — Pass `sessionId` in `GeminiAgentOptions` to resume a previous
conversation. During `initialize()`, the agent looks up the session file, reconstructs
the chat history from `MessageRecord[]`, and calls `GeminiClient.resumeChat()` so the
model sees the full prior conversation.

**Context Compression** — Pass `compressionThreshold` (0-1 fraction) to control when
automatic context compression kicks in. The core library emits `ChatCompressed` events
(accessible via `GeminiEventType.ChatCompressed`) when compression occurs during
`sendMessageStream()`.

### Logging Control (logger.ts)

```ts
type LogLevel = "silent" | "error" | "warn" | "info" | "debug"

interface Logger {
  log?:   (...args: unknown[]) => void
  warn?:  (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

function patchCoreLogger(level: LogLevel, logger?: Logger): void
```

`@google/gemini-cli-core` outputs debug logs via a `debugLogger` singleton that calls
`console.log/warn/error/debug` unconditionally. The SDK patches this singleton at
agent construction time to route logs through a configurable level system.

| Level    | Output                              |
| -------- | ----------------------------------- |
| `silent` | Suppress all core logs (default)    |
| `error`  | Only errors                         |
| `warn`   | Errors + warnings                   |
| `info`   | Errors + warnings + info            |
| `debug`  | Everything (matches core behavior)  |

The default is `"silent"` because SDK consumers typically don't want to see the core
library's internal debug output (experiment dumps, routing decisions, retry traces, etc.).
Pass `logLevel: "debug"` in `GeminiAgentOptions` to restore the original noisy behavior.

**Custom log destination** — Pass `logger` in `GeminiAgentOptions` to route filtered
logs to a custom destination instead of `console`. All methods are optional; missing
methods are treated as no-ops for that level. This is useful for integrating with
external logging libraries (pino, winston, etc.).

### `skillDir()` (skills.ts)

```ts
type SkillRef = { type: "dir"; path: string }
function skillDir(path: string): SkillRef
```

## Internal Architecture

### File Structure

```
src/
  index.ts      — barrel re-exports
  agent.ts      — GeminiAgent class
  logger.ts     — LogLevel type, patchCoreLogger() helper
  session.ts    — listSessions(), loadSession(), messageRecordsToHistory()
  tool.ts       — defineTool(), ToolDef, ToolAction, ToolError, SdkTool, SdkToolInvocation
  context.ts    — SessionContext + AgentFs/AgentShell interfaces + internal implementations
  skills.ts     — SkillRef type, skillDir() helper
```

### agent.ts internals

`GeminiAgent.sendStream()` is decomposed into private helpers:

- `initialize()` — lazy auth + config init + session resume + tool/skill registration (runs once)
- `resolveInstructions(ctx)` — evaluate dynamic instructions function (runs once)
- `buildScopedRegistry(ctx)` — create per-turn registry with context-bound SdkTools
- `extractToolCalls(events, sessionId)` — filter ToolCallRequest events into scheduling format

### tool.ts internals

- `SdkTool<T>` extends `BaseDeclarativeTool` — wraps a `ToolDef` for the core registry.
  `withContext(ctx)` returns a new instance with bound `SessionContext`.
- `SdkToolInvocation<T>` extends `BaseToolInvocation` — executes the user-defined action.
  `private serialize(value)` formats the result for LLM consumption.

### context.ts internals

- `AgentFsImpl` — validates path access via `Config.validatePathAccess()`, then
  delegates to `node:fs/promises`.
- `AgentShellImpl` — checks execution policy via `ShellTool.shouldConfirmExecute()`,
  then runs command via `ShellExecutionService.execute()`.
  `private canExecute()` encapsulates the policy check.
