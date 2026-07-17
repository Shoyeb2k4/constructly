/**
 * Structured logging + a single error-reporting seam. In production, logs are
 * emitted as one-line JSON (easy to ship to a log drain); in development they
 * are human-readable. `reportError` is the hook a monitoring platform (Sentry,
 * etc.) plugs into later — swap the body without touching call sites.
 */

type Level = "debug" | "info" | "warn" | "error";

const isProd = process.env.NODE_ENV === "production";

export interface LogContext {
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext) {
  const entry = { level, message, time: new Date().toISOString(), ...context };
  const line = isProd ? JSON.stringify(entry) : `[${level}] ${message}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (isProd) fn(line);
  else fn(line, context ?? "");
}

export const logger = {
  debug: (m: string, c?: LogContext) => !isProd && emit("debug", m, c),
  info: (m: string, c?: LogContext) => emit("info", m, c),
  warn: (m: string, c?: LogContext) => emit("warn", m, c),
  error: (m: string, c?: LogContext) => emit("error", m, c),
};

/**
 * Central error sink. Call from server catch blocks, error boundaries, and the
 * client error reporter. Today it logs; wiring Sentry is a one-line change here.
 */
export function reportError(error: unknown, context?: LogContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(err.message, { ...context, stack: err.stack });
  // Future: Sentry.captureException(err, { extra: context });
}
