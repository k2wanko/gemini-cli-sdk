import { debugLogger } from "@google/gemini-cli-core";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SessionContext } from "./context.js";
import { defineTool, type ToolDef } from "./tool.js";

// ---------------------------------------------------------------------------
// JSON Schema types (simplified subset used for type generation)
// ---------------------------------------------------------------------------

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
}

export interface Executor {
  execute(
    code: string,
    fns: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult>;
}

// ---------------------------------------------------------------------------
// JSON Schema -> TypeScript type string conversion
// ---------------------------------------------------------------------------

function jsonSchemaToTs(schema: JsonSchema, depth = 0): string {
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (schema.anyOf ?? schema.oneOf) {
    const variants = (schema.anyOf ?? schema.oneOf ?? []).map((s) =>
      jsonSchemaToTs(s, depth),
    );
    return variants.join(" | ");
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];

  if (types.includes("string")) return "string";
  if (types.includes("number") || types.includes("integer")) return "number";
  if (types.includes("boolean")) return "boolean";
  if (types.includes("null")) return "null";

  if (types.includes("array") || schema.items) {
    const items = schema.items
      ? jsonSchemaToTs(schema.items, depth)
      : "unknown";
    return `${items}[]`;
  }

  if (types.includes("object") || schema.properties) {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const indent = "  ".repeat(depth + 1);
    const closing = "  ".repeat(depth);
    const entries = Object.entries(props).map(([key, val]) => {
      const opt = required.has(key) ? "" : "?";
      const comment = val.description ? `/** ${val.description} */ ` : "";
      return `${indent}${comment}${key}${opt}: ${jsonSchemaToTs(val, depth + 1)}`;
    });
    if (entries.length === 0) return "Record<string, unknown>";
    return `{\n${entries.join(";\n")};\n${closing}}`;
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// API docs generation from ToolDef array (JSDoc-style, for LLM consumption)
// ---------------------------------------------------------------------------

function jsonSchemaToParams(schema: JsonSchema, prefix = ""): string[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(props).map(([key, val]) => {
    const opt = required.has(key) ? "" : "?";
    const type = jsonSchemaToTs(val);
    const desc = val.description ? ` — ${val.description}` : "";
    return `//   ${prefix}${key}${opt}: ${type}${desc}`;
  });
}

function generateApiDocs(tools: ToolDef<any>[]): string {
  debugLogger.debug?.("[codemode] generateApiDocs: %d tools", tools.length);
  const sections = tools.map((tool) => {
    const schema = zodToJsonSchema(tool.inputSchema) as JsonSchema;
    const params = jsonSchemaToParams(schema);
    const desc = tool.description ? ` — ${tool.description}` : "";
    const lines = [`// codemode.${tool.name}(input)${desc}`, ...params];
    return lines.join("\n");
  });
  return sections.join("\n//\n");
}

// ---------------------------------------------------------------------------
// NodeVMExecutor
// ---------------------------------------------------------------------------

export class NodeVMExecutor implements Executor {
  async execute(
    code: string,
    fns: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult> {
    debugLogger.debug?.("[codemode:executor] execute called, code length=%d, available fns=%s", code.length, Object.keys(fns).join(", "));
    debugLogger.debug?.("[codemode:executor] code:\n%s", code);

    const logs: string[] = [];

    const stringify = (v: unknown) =>
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

    const captureConsole = {
      log: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
      warn: (...args: unknown[]) =>
        logs.push(`[warn] ${args.map(stringify).join(" ")}`),
      error: (...args: unknown[]) =>
        logs.push(`[error] ${args.map(stringify).join(" ")}`),
    };

    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {})
        .constructor as new (
        ...args: string[]
      ) => (...callArgs: unknown[]) => Promise<unknown>;

      const fn = new AsyncFunction("codemode", "console", code);

      debugLogger.debug?.("[codemode:executor] starting execution");

      const result = await fn(fns, captureConsole);

      debugLogger.debug?.("[codemode:executor] execution completed, result=%s, logs=%d", typeof result, logs.length);

      return {
        result,
        logs: logs.length > 0 ? logs : undefined,
      };
    } catch (error) {
      debugLogger.debug?.("[codemode:executor] execution failed: %s", error instanceof Error ? error.message : String(error));
      return {
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
        logs: logs.length > 0 ? logs : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// createCodeModeTool
// ---------------------------------------------------------------------------

export function createCodeModeTool(options: {
  tools: ToolDef<any>[];
  executor?: Executor;
  description?: string;
}) {
  const executor = options.executor ?? new NodeVMExecutor();
  const apiDocs = generateApiDocs(options.tools);

  const description =
    options.description ??
    `Write and execute plain JavaScript (NOT TypeScript) to orchestrate multiple tools.

The \`codemode\` object exposes all available tools as async functions.
Always end your code with a \`return\` statement to return the final result.

Available tools:
\`\`\`javascript
${apiDocs}
\`\`\`

Example:
\`\`\`javascript
const result = await codemode.toolName({ param: "value" });
return result;
\`\`\``;

  debugLogger.debug?.("[codemode] createCodeModeTool: registering %d tools", options.tools.length);

  return defineTool(
    {
      name: "code",
      description,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "JavaScript code to execute. Must use `return` to return the final result.",
          ),
      }),
      sendErrorsToModel: true,
    },
    async ({ code }, context: SessionContext) => {
      debugLogger.debug?.("[codemode] tool invoked, code length=%d", code.length);

      const fns: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

      for (const tool of options.tools) {
        fns[tool.name] = (input: unknown) => {
          debugLogger.debug?.("[codemode] calling tool '%s' with input: %s", tool.name, JSON.stringify(input));
          return tool.action(input as z.infer<typeof tool.inputSchema>, context);
        };
      }

      const execResult = await executor.execute(code, fns);

      const output: Record<string, unknown> = {};
      if (execResult.result !== undefined) output.result = execResult.result;
      if (execResult.error) output.error = execResult.error;
      if (execResult.logs && execResult.logs.length > 0)
        output.logs = execResult.logs;

      debugLogger.debug?.("[codemode] tool output: %s", JSON.stringify(output));

      return output;
    },
  );
}
