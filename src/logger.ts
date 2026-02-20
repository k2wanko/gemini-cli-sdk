import { debugLogger } from "@google/gemini-cli-core";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface Logger {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const noop = () => {};

export function patchCoreLogger(level: LogLevel, logger?: Logger): void {
  const threshold = LOG_LEVEL_ORDER[level];
  const dest = logger ?? console;

  debugLogger.log =
    threshold >= LOG_LEVEL_ORDER.info ? (dest.log ?? noop).bind(dest) : noop;
  debugLogger.warn =
    threshold >= LOG_LEVEL_ORDER.warn ? (dest.warn ?? noop).bind(dest) : noop;
  debugLogger.error =
    threshold >= LOG_LEVEL_ORDER.error ? (dest.error ?? noop).bind(dest) : noop;
  debugLogger.debug =
    threshold >= LOG_LEVEL_ORDER.debug ? (dest.debug ?? noop).bind(dest) : noop;
}
