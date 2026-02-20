import type { Message, Part, Task } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import {
  AgentTerminateMode,
  type LocalAgentDefinition,
  LocalAgentExecutor,
  loadAgentsFromDirectory,
  type RemoteAgentDefinition,
  type SubagentActivityEvent,
} from "@google/gemini-cli-core";
import { z } from "zod";
import type { SessionContext } from "./context.js";
import { type ToolDef, ToolError } from "./tool.js";

// ---------------------------------------------------------------------------
// Re-exports from core
// ---------------------------------------------------------------------------

export {
  AgentTerminateMode,
  type SubagentActivityEvent,
  type LocalAgentDefinition,
  type RemoteAgentDefinition,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A prompt value that can be a static string or a function that dynamically
 * resolves at invocation time. The function receives the tool input params
 * and the parent's SessionContext.
 *
 * The resolved string still supports core's `${paramName}` template syntax,
 * so both mechanisms can be combined.
 */
export type PromptValue<TInput extends z.ZodRawShape> =
  | string
  | ((
      params: z.infer<z.ZodObject<TInput>>,
      ctx: SessionContext,
    ) => string | Promise<string>);

export interface SubAgentOptions<TInput extends z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: z.ZodObject<TInput>;

  /**
   * System prompt — a static string or a function for dynamic resolution.
   * Supports core's `${paramName}` template syntax (applied after resolution).
   */
  systemPrompt: PromptValue<TInput>;
  /**
   * Initial query — a static string or a function for dynamic resolution.
   * Supports core's `${paramName}` template syntax (applied after resolution).
   * Default: core's "Get Started!"
   */
  query?: PromptValue<TInput>;

  /** Model. Default: "inherit" (parent's active model) */
  model?: string;
  /** Max turns. Omit to use core default. */
  maxTurns?: number;
  /** Max execution time in minutes. Omit to use core default. */
  maxTimeMinutes?: number;

  /**
   * Tools the sub-agent can use (tool names from parent registry).
   * Include "activate_skill" to enable skills.
   * If omitted: inherits ALL parent tools.
   */
  tools?: string[];

  /** Activity callback for observability */
  onActivity?: (event: SubagentActivityEvent) => void;
}

// ---------------------------------------------------------------------------
// defineSubAgent — Programmatic API
// ---------------------------------------------------------------------------

/**
 * Define a local sub-agent programmatically. Returns a `ToolDef` compatible
 * with `GeminiAgent.tools`.
 */
export function defineSubAgent<TInput extends z.ZodRawShape>(
  options: SubAgentOptions<TInput>,
): ToolDef<z.ZodObject<TInput>> {
  const hasDynamicPrompt =
    typeof options.systemPrompt === "function" ||
    typeof options.query === "function";

  // Fast path: when both prompts are static strings, build the definition
  // upfront and delegate to the shared helper.
  if (!hasDynamicPrompt) {
    const def = buildLocalAgentDef(
      options,
      options.systemPrompt as string,
      options.query as string | undefined,
    );
    return wrapLocalAgentAsTool(def, options.inputSchema, options.onActivity);
  }

  // Dynamic path: resolve prompt values inside the action.
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    sendErrorsToModel: true,
    action: async (
      params: z.infer<z.ZodObject<TInput>>,
      ctx: SessionContext,
    ) => {
      const resolvedSystemPrompt = await resolvePromptValue(
        options.systemPrompt,
        params,
        ctx,
      );
      const resolvedQuery =
        options.query !== undefined
          ? await resolvePromptValue(options.query, params, ctx)
          : undefined;

      const def = buildLocalAgentDef(
        options,
        resolvedSystemPrompt,
        resolvedQuery,
      );
      return executeLocalAgent(def, params, ctx, options.onActivity);
    },
  };
}

// ---------------------------------------------------------------------------
// loadSubAgents — File-based API
// ---------------------------------------------------------------------------

/**
 * Load sub-agent definitions from `.md` files in a directory.
 * Each file becomes a `ToolDef` compatible with `GeminiAgent.tools`.
 *
 * Files starting with `_` are ignored by core's loader.
 */
export async function loadSubAgents(
  dir: string,
  options?: { onActivity?: (event: SubagentActivityEvent) => void },
): Promise<ToolDef<any>[]> {
  const { agents, errors } = await loadAgentsFromDirectory(dir);

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(
        `[subagent] Failed to load ${err.filePath}: ${err.message}`,
      );
    }
  }

  const querySchema = z.object({
    query: z.string().optional().describe("Input query for the sub-agent"),
  });

  const tools: ToolDef<typeof querySchema>[] = [];

  for (const def of agents) {
    if (def.kind === "local") {
      tools.push(wrapLocalAgentAsTool(def, querySchema, options?.onActivity));
    } else if (def.kind === "remote") {
      tools.push(wrapRemoteAgentAsTool(def, querySchema));
    }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Internal: prompt resolution
// ---------------------------------------------------------------------------

async function resolvePromptValue<TInput extends z.ZodRawShape>(
  value: PromptValue<TInput>,
  params: z.infer<z.ZodObject<TInput>>,
  ctx: SessionContext,
): Promise<string> {
  return typeof value === "function" ? value(params, ctx) : value;
}

// ---------------------------------------------------------------------------
// Internal: build LocalAgentDefinition from SubAgentOptions + resolved strings
// ---------------------------------------------------------------------------

function buildLocalAgentDef<TInput extends z.ZodRawShape>(
  options: SubAgentOptions<TInput>,
  systemPrompt: string,
  query: string | undefined,
): LocalAgentDefinition {
  return {
    kind: "local",
    name: options.name,
    description: options.description,
    inputConfig: {
      inputSchema: zodToJsonSchemaSimple(options.inputSchema),
    },
    promptConfig: {
      systemPrompt,
      ...(query !== undefined && { query }),
    },
    modelConfig: { model: options.model ?? "inherit" },
    runConfig: {
      ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
      ...(options.maxTimeMinutes !== undefined && {
        maxTimeMinutes: options.maxTimeMinutes,
      }),
    },
    ...(options.tools && { toolConfig: { tools: options.tools } }),
  };
}

// ---------------------------------------------------------------------------
// Internal: execute a local agent (shared by wrapLocalAgentAsTool & dynamic path)
// ---------------------------------------------------------------------------

async function executeLocalAgent(
  def: LocalAgentDefinition,
  params: Record<string, unknown>,
  ctx: SessionContext,
  onActivity?: (event: SubagentActivityEvent) => void,
): Promise<string> {
  const config = ctx.agent.getCoreConfig();

  // Register model config alias — replicates AgentRegistry.registerModelConfigs()
  const alias = `${def.name}-config`;
  config.modelConfigService.registerRuntimeModelConfig(alias, {
    modelConfig: {
      model:
        def.modelConfig.model === "inherit"
          ? config.getActiveModel()
          : def.modelConfig.model,
      ...(def.modelConfig.generateContentConfig && {
        generateContentConfig: def.modelConfig.generateContentConfig,
      }),
    },
  });

  const executor = await LocalAgentExecutor.create(def, config, onActivity);
  const result = await executor.run(params, new AbortController().signal);

  if (result.terminate_reason !== AgentTerminateMode.GOAL) {
    throw new ToolError(
      `Sub-agent "${def.name}" terminated: ${result.terminate_reason}`,
    );
  }

  return result.result;
}

// ---------------------------------------------------------------------------
// Internal: wrapLocalAgentAsTool
// ---------------------------------------------------------------------------

function wrapLocalAgentAsTool<T extends z.ZodTypeAny>(
  def: LocalAgentDefinition,
  inputSchema: T,
  onActivity?: (event: SubagentActivityEvent) => void,
): ToolDef<T> {
  return {
    name: def.name,
    description: def.description,
    inputSchema,
    sendErrorsToModel: true,
    action: async (params: z.infer<T>, ctx: SessionContext) => {
      return executeLocalAgent(
        def,
        params as Record<string, unknown>,
        ctx,
        onActivity,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: wrapRemoteAgentAsTool
// ---------------------------------------------------------------------------

/** Cached ClientFactory instance (shared across all remote agents) */
let sharedClientFactory: ClientFactory | undefined;

function getClientFactory(): ClientFactory {
  if (!sharedClientFactory) {
    sharedClientFactory = new ClientFactory();
  }
  return sharedClientFactory;
}

function wrapRemoteAgentAsTool<T extends z.ZodTypeAny>(
  def: RemoteAgentDefinition,
  inputSchema: T,
): ToolDef<T> {
  return {
    name: def.name,
    description: def.description,
    inputSchema,
    sendErrorsToModel: true,
    action: async (params: z.infer<T>) => {
      const factory = getClientFactory();
      const client = await factory.createFromUrl(def.agentCardUrl, "");

      const query =
        typeof params === "object" && params !== null && "query" in params
          ? String(params.query ?? "")
          : JSON.stringify(params);

      const result = await client.sendMessage({
        message: {
          kind: "message",
          messageId: crypto.randomUUID(),
          role: "user",
          parts: [{ kind: "text", text: query }],
        },
        configuration: { blocking: true },
      });

      return extractTextFromResult(result);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: A2A text extraction
// ---------------------------------------------------------------------------

function extractTextFromResult(result: Message | Task): string {
  if (result.kind === "message") {
    return extractTextFromParts(result.parts);
  }
  // Task
  const parts = result.status?.message?.parts;
  if (parts) {
    return extractTextFromParts(parts as Part[]);
  }
  return "";
}

function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter(
      (p): p is Part & { kind: "text"; text: string } => p.kind === "text",
    )
    .map((p) => p.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Internal: minimal Zod-to-JSON-Schema for inputConfig
// ---------------------------------------------------------------------------

function zodToJsonSchemaSimple(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodTypeAny;
    const prop: Record<string, unknown> = { type: "string" };

    if (zodType.description) {
      prop.description = zodType.description;
    }

    // Unwrap optional
    if (zodType instanceof z.ZodOptional) {
      // optional — don't add to required
    } else {
      required.push(key);
    }

    properties[key] = prop;
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };
}
