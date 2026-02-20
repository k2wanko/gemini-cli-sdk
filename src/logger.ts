import { debugLogger } from "@google/gemini-cli-core";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const noop = () => {};

export function patchCoreLogger(level: LogLevel): void {
  const threshold = LOG_LEVEL_ORDER[level];

  debugLogger.log =
    threshold >= LOG_LEVEL_ORDER.info ? console.log.bind(console) : noop;
  debugLogger.warn =
    threshold >= LOG_LEVEL_ORDER.warn ? console.warn.bind(console) : noop;
  debugLogger.error =
    threshold >= LOG_LEVEL_ORDER.error ? console.error.bind(console) : noop;
  debugLogger.debug =
    threshold >= LOG_LEVEL_ORDER.debug ? console.debug.bind(console) : noop;
}
