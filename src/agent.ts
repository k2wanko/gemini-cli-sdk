import {
  ActivateSkillTool,
  AuthType,
  Config,
  type ConfigParameters,
  type Content,
  type GeminiClient,
  GeminiEventType,
  getAuthTypeFromEnv,
  loadSkillsFromDir,
  PolicyDecision,
  PREVIEW_GEMINI_MODEL_AUTO,
  type ServerGeminiStreamEvent,
  scheduleAgentTools,
  type ToolCallRequestInfo,
  type ToolRegistry,
} from "@google/gemini-cli-core";
import { AgentFsImpl, AgentShellImpl, type SessionContext } from "./context.js";
import { type Logger, type LogLevel, patchCoreLogger } from "./logger.js";
import {
  listSessions,
  loadSession,
  messageRecordsToHistory,
} from "./session.js";
import type { SkillRef } from "./skills.js";
import { SdkTool, type ToolDef } from "./tool.js";

export { GeminiEventType, type ServerGeminiStreamEvent };

export interface GeminiAgentOptions {
  instructions: string | ((ctx: SessionContext) => string | Promise<string>);
  tools?: ToolDef<any>[];
  skills?: SkillRef[];
  model?: string;
  cwd?: string;
  debug?: boolean;
  /** Resume a specific session by ID */
  sessionId?: string;
  /** Context compression threshold (0-1 fraction) */
  compressionThreshold?: number;
  /** Core logger verbosity — default: "silent" */
  logLevel?: LogLevel;
  /** Custom log destination — defaults to console when logLevel is not "silent" */
  logger?: Logger;
}

export class GeminiAgent {
  private readonly config: Config;
  private readonly tools: ToolDef<any>[];
  private readonly skillRefs: SkillRef[];
  private readonly instructions: GeminiAgentOptions["instructions"];
  private readonly resumeSessionId: string | undefined;
  private instructionsLoaded = false;

  constructor(options: GeminiAgentOptions) {
    patchCoreLogger(options.logLevel ?? "silent", options.logger);

    this.instructions = options.instructions;
    this.tools = options.tools ?? [];
    this.skillRefs = options.skills ?? [];
    this.resumeSessionId = options.sessionId;

    const cwd = options.cwd ?? process.cwd();
    const initialMemory =
      typeof this.instructions === "string" ? this.instructions : "";

    const configParams: ConfigParameters = {
      sessionId: crypto.randomUUID(),
      targetDir: cwd,
      cwd,
      debugMode: options.debug ?? false,
      model: options.model ?? PREVIEW_GEMINI_MODEL_AUTO,
      userMemory: initialMemory,
      enableHooks: false,
      mcpEnabled: false,
      extensionsEnabled: false,
      skillsSupport: true,
      adminSkillsEnabled: true,
      policyEngineConfig: {
        defaultDecision: PolicyDecision.ALLOW,
      },
      compressionThreshold: options.compressionThreshold,
    };

    this.config = new Config(configParams);
  }

  /** Return the session ID assigned to this agent instance */
  getSessionId(): string {
    return this.config.getSessionId();
  }

  /** List available sessions for the current project */
  async listSessions(): Promise<import("./session.js").SessionInfo[]> {
    await this.ensureInitialized();
    return listSessions(this.config);
  }

  async *sendStream(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    await this.initialize();

    const client = this.config.getGeminiClient();
    const abortSignal = signal ?? new AbortController().signal;
    const sessionId = this.config.getSessionId();

    const agentFs = new AgentFsImpl(this.config);
    const agentShell = new AgentShellImpl(this.config);

    let request: Parameters<GeminiClient["sendMessageStream"]>[0] = [
      { text: prompt },
    ];

    if (!this.instructionsLoaded) {
      const ctx: SessionContext = {
        sessionId,
        transcript: client.getHistory(),
        cwd: this.config.getWorkingDir(),
        timestamp: new Date().toISOString(),
        fs: agentFs,
        shell: agentShell,
        agent: this,
      };
      await this.resolveInstructions(ctx, client);
    }

    while (true) {
      const stream = client.sendMessageStream(request, abortSignal, sessionId);
      const events: ServerGeminiStreamEvent[] = [];

      for await (const event of stream) {
        yield event;
        events.push(event);
      }

      const toolCalls = this.extractToolCalls(events, sessionId);
      if (toolCalls.length === 0) break;

      const transcript: Content[] = client.getHistory();
      const ctx: SessionContext = {
        sessionId,
        transcript,
        cwd: this.config.getWorkingDir(),
        timestamp: new Date().toISOString(),
        fs: agentFs,
        shell: agentShell,
        agent: this,
      };

      const scopedRegistry = this.buildScopedRegistry(ctx);

      const completedCalls = await scheduleAgentTools(this.config, toolCalls, {
        schedulerId: sessionId,
        toolRegistry: scopedRegistry,
        signal: abortSignal,
      });

      const functionResponses = completedCalls.flatMap(
        (call) => call.response.responseParts,
      );

      request = functionResponses as unknown as Parameters<
        GeminiClient["sendMessageStream"]
      >[0];
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const authType = getAuthTypeFromEnv() || AuthType.COMPUTE_ADC;
    await this.config.refreshAuth(authType);
    await this.config.initialize();
    this.initialized = true;
  }

  private async initialize(): Promise<void> {
    if (this.config.getContentGenerator()) return;

    await this.ensureInitialized();

    // Resume previous session if requested
    if (this.resumeSessionId) {
      const sessions = await listSessions(this.config);
      const target = sessions.find((s) => s.sessionId === this.resumeSessionId);
      if (target) {
        const resumed = await loadSession(target.filePath);
        const history = messageRecordsToHistory(resumed.conversation.messages);
        const client = this.config.getGeminiClient();
        await client.resumeChat(history, resumed);
      }
    }

    // Load skills from directories
    if (this.skillRefs.length > 0) {
      const skillManager = this.config.getSkillManager();

      const loadPromises = this.skillRefs.map(async (ref) => {
        try {
          if (ref.type === "dir") {
            return await loadSkillsFromDir(ref.path);
          }
        } catch (e) {
          console.error(`Failed to load skills from ${ref.path}:`, e);
        }
        return [];
      });

      const loadedSkills = (await Promise.all(loadPromises)).flat();
      if (loadedSkills.length > 0) {
        skillManager.addSkills(loadedSkills);
      }
    }

    // Re-register ActivateSkillTool so its schema reflects all loaded skills
    const skillManager = this.config.getSkillManager();
    if (skillManager.getSkills().length > 0) {
      const registry = this.config.getToolRegistry();
      const toolName = ActivateSkillTool.Name;
      if (registry.getTool(toolName)) {
        registry.unregisterTool(toolName);
      }
      registry.registerTool(
        new ActivateSkillTool(this.config, this.config.getMessageBus()),
      );
    }

    // Register user-defined tools
    const registry = this.config.getToolRegistry();
    const messageBus = this.config.getMessageBus();

    for (const toolDef of this.tools) {
      const sdkTool = new SdkTool(toolDef, messageBus, this);
      registry.registerTool(sdkTool);
    }
  }

  private async resolveInstructions(
    ctx: SessionContext,
    client: GeminiClient,
  ): Promise<void> {
    if (typeof this.instructions !== "function") return;

    const resolved = await this.instructions(ctx);
    this.config.setUserMemory(resolved);
    client.updateSystemInstruction();
    this.instructionsLoaded = true;
  }

  private buildScopedRegistry(ctx: SessionContext): ToolRegistry {
    const originalRegistry = this.config.getToolRegistry();
    const scopedRegistry: ToolRegistry = Object.create(
      originalRegistry,
    ) as ToolRegistry;
    scopedRegistry.getTool = (name: string) => {
      const tool = originalRegistry.getTool(name);
      if (tool instanceof SdkTool) {
        return tool.withContext(ctx);
      }
      return tool;
    };
    return scopedRegistry;
  }

  private extractToolCalls(
    events: ServerGeminiStreamEvent[],
    sessionId: string,
  ): ToolCallRequestInfo[] {
    const calls: ToolCallRequestInfo[] = [];
    for (const event of events) {
      if (event.type === GeminiEventType.ToolCallRequest) {
        const toolCall = event.value;
        const args =
          typeof toolCall.args === "string"
            ? (JSON.parse(toolCall.args) as Record<string, unknown>)
            : toolCall.args;
        calls.push({
          ...toolCall,
          args,
          isClientInitiated: false,
          prompt_id: sessionId,
        });
      }
    }
    return calls;
  }
}
