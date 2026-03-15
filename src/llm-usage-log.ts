import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE_LOG_DIR = join(homedir(), ".openclaw", "usage-logs");
const USAGE_LOG_PATH = join(USAGE_LOG_DIR, "lcm-llm-usage.jsonl");

type UsageLogStatus = "started" | "completed" | "failed";

type UsageLogEntry = {
  ts: string;
  status: UsageLogStatus;
  subsystem: "summarize" | "session-state" | "embedding" | "reranker";
  provider?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  requestId: string;
  request?: unknown;
  response?: unknown;
  error?: string;
  durationMs?: number;
};

function ensureUsageLogDir(): void {
  mkdirSync(USAGE_LOG_DIR, { recursive: true });
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return JSON.stringify({
      serializationError: err instanceof Error ? err.message : String(err),
    });
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  if ("Authorization" in redacted) {
    redacted.Authorization = "[REDACTED]";
  }
  if ("authorization" in redacted) {
    redacted.authorization = "[REDACTED]";
  }
  return redacted;
}

export function createUsageLogRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildHttpUsageRequest(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}): Record<string, unknown> {
  return {
    url: input.url,
    method: input.method,
    headers: redactHeaders(input.headers),
    body: input.body ?? null,
  };
}

export function writeLlmUsageLog(entry: UsageLogEntry): void {
  try {
    ensureUsageLogDir();
    appendFileSync(USAGE_LOG_PATH, stringifySafe(entry) + "\n", "utf8");
  } catch {
    // best-effort
  }
}
