import fs from "node:fs/promises";
import type { Content, Config as CoreConfig } from "@google/gemini-cli-core";
import { ShellExecutionService, ShellTool } from "@google/gemini-cli-core";
import type { GeminiAgent } from "./agent.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AgentFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ShellOptions {
  env?: Record<string, string>;
  timeout?: number;
  cwd?: string;
}

export interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface AgentShell {
  exec(cmd: string, options?: ShellOptions): Promise<ShellResult>;
}

export interface SessionContext {
  sessionId: string;
  cwd: string;
  transcript: Content[];
  timestamp: string;
  fs: AgentFs;
  shell: AgentShell;
  agent: GeminiAgent;
}

// ---------------------------------------------------------------------------
// Internal implementations (exported for use by agent.ts, not part of
// the intended public API)
// ---------------------------------------------------------------------------

export class AgentFsImpl implements AgentFs {
  constructor(private readonly config: CoreConfig) {}

  async readFile(path: string): Promise<string | null> {
    const error = this.config.validatePathAccess(path, "read");
    if (error) return null;
    try {
      return await fs.readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const error = this.config.validatePathAccess(path, "write");
    if (error) throw new Error(error);
    await fs.writeFile(path, content, "utf-8");
  }
}

export class AgentShellImpl implements AgentShell {
  constructor(private readonly config: CoreConfig) {}

  async exec(command: string, options?: ShellOptions): Promise<ShellResult> {
    const cwd = options?.cwd ?? this.config.getWorkingDir();
    const abortController = new AbortController();

    const allowed = await this.canExecute(command, cwd);
    if (!allowed) {
      return {
        stdout: "",
        stderr:
          "Command execution requires confirmation but no interactive session is available.",
        exitCode: 1,
        error: new Error("Command blocked by policy"),
      };
    }

    const handle = await ShellExecutionService.execute(
      command,
      cwd,
      () => {},
      abortController.signal,
      false,
      this.config.getShellExecutionConfig(),
    );

    const result = await handle.result;

    return {
      stdout: result.output,
      stderr: "",
      exitCode: result.exitCode,
    };
  }

  private async canExecute(command: string, cwd: string): Promise<boolean> {
    const shellTool = new ShellTool(this.config, this.config.getMessageBus());
    try {
      const invocation = shellTool.build({ command, dir_path: cwd });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      return !confirmation;
    } catch {
      return false;
    }
  }
}
