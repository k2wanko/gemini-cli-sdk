import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type MessageBus,
  type ToolInvocation,
  type ToolResult,
} from "@google/gemini-cli-core";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SessionContext } from "./context.js";

export { z };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class ToolError extends Error {
  constructor(message: string | Error) {
    super(message instanceof Error ? message.message : message);
    this.name = "ToolError";
  }
}

export type ToolAction<T extends z.ZodTypeAny> = (
  params: z.infer<T>,
  context: SessionContext,
) => Promise<unknown>;

export interface ToolDef<T extends z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: T;
  sendErrorsToModel?: boolean;
  action: ToolAction<T>;
}

export function defineTool<T extends z.ZodTypeAny>(
  config: {
    name: string;
    description: string;
    inputSchema: T;
    sendErrorsToModel?: boolean;
  },
  action: ToolAction<T>,
): ToolDef<T> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    sendErrorsToModel: config.sendErrorsToModel,
    action,
  };
}

// ---------------------------------------------------------------------------
// Internal: SdkToolInvocation
// ---------------------------------------------------------------------------

class SdkToolInvocation<T extends z.ZodTypeAny> extends BaseToolInvocation<
  z.infer<T>,
  ToolResult
> {
  constructor(
    params: z.infer<T>,
    messageBus: MessageBus,
    private readonly action: ToolAction<T>,
    private readonly context: SessionContext | undefined,
    toolName: string,
    private readonly sendErrorsToModel: boolean,
  ) {
    super(params, messageBus, toolName);
  }

  getDescription(): string {
    return `Executing ${this._toolName}...`;
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    try {
      const result = await this.action(
        this.params,
        this.context as SessionContext,
      );
      const output = this.serialize(result);
      return { llmContent: output, returnDisplay: output };
    } catch (error) {
      if (this.sendErrorsToModel || error instanceof ToolError) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          llmContent: `Error: ${message}`,
          returnDisplay: `Error: ${message}`,
          error: { message },
        };
      }
      throw error;
    }
  }

  private serialize(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Internal: SdkTool (exported for use by agent.ts)
// ---------------------------------------------------------------------------

export class SdkTool<T extends z.ZodTypeAny> extends BaseDeclarativeTool<
  z.infer<T>,
  ToolResult
> {
  constructor(
    private readonly def: ToolDef<T>,
    messageBus: MessageBus,
    _agent?: unknown,
    private readonly context?: SessionContext,
  ) {
    super(
      def.name,
      def.name,
      def.description,
      Kind.Other,
      zodToJsonSchema(def.inputSchema),
      messageBus,
    );
  }

  withContext(context: SessionContext): SdkTool<T> {
    return new SdkTool(this.def, this.messageBus, undefined, context);
  }

  protected createInvocation(
    params: z.infer<T>,
    messageBus: MessageBus,
    toolName?: string,
  ): ToolInvocation<z.infer<T>, ToolResult> {
    return new SdkToolInvocation(
      params,
      messageBus,
      this.def.action,
      this.context,
      toolName ?? this.name,
      this.def.sendErrorsToModel ?? false,
    );
  }
}
