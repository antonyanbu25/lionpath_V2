/**
 * Structured JSON logger — Cloud Logging parses the `severity` field.
 */

import { getCorrelationId } from "./request-context";

export type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface LogFields {
  [key: string]: unknown;
}

function emit(severity: LogSeverity, message: string, fields?: LogFields): void {
  const correlationId = getCorrelationId();
  const entry: Record<string, unknown> = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId ? { correlationId } : {}),
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (severity === "ERROR") console.error(line);
  else if (severity === "WARNING") console.warn(line);
  else console.log(line);
}

export function logDebug(message: string, fields?: LogFields): void {
  emit("DEBUG", message, fields);
}

export function logInfo(message: string, fields?: LogFields): void {
  emit("INFO", message, fields);
}

export function logWarn(message: string, fields?: LogFields): void {
  emit("WARNING", message, fields);
}

export function logError(message: string, fields?: LogFields): void {
  emit("ERROR", message, fields);
}
