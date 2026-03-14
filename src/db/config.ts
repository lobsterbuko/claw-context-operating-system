import { homedir } from "os";
import { join } from "path";

export type LcmConfig = {
  enabled: boolean;
  databasePath: string;
  contextThreshold: number;
  freshTailCount: number;
  leafMinFanout: number;
  condensedMinFanout: number;
  condensedMinFanoutHard: number;
  incrementalMaxDepth: number;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
  maxExpandTokens: number;
  largeFileTokenThreshold: number;
  /** Provider override for large-file text summarization. */
  largeFileSummaryProvider: string;
  /** Model override for large-file text summarization. */
  largeFileSummaryModel: string;
  autocompactDisabled: boolean;
  /** IANA timezone for timestamps in summaries (from TZ env or system default) */
  timezone: string;
  /** When true, retroactively delete HEARTBEAT_OK turn cycles from LCM storage. */
  pruneHeartbeatOk: boolean;
  // ── Ozempic — Tier 1 engine features ────────────────────────────────────────
  /** Run a compaction pass before assembly when context is above pressure threshold. */
  pressureLoop: boolean;
  /** Maximum compaction passes to run in the pre-assembly pressure loop. */
  pressureMaxPasses: number;
  /** Trim oldest fresh-tail items instead of overflowing when fresh tail exceeds budget. */
  freshTailTrimUnderPressure: boolean;
  /** Classify tool results by provenance kind (observed / computed / mutation). */
  provenanceTyping: boolean;
  /** Evict stale observed results after a mutation to the same tool. */
  provenanceEviction: boolean;
  // ── Ozempic — Tier 2 heuristic features ─────────────────────────────────────
  /** Summary inclusion strategy: "always" | "on-demand" | "auto". */
  summaryMode: "always" | "on-demand" | "auto";
  /** Max tokens per tool result in assembled context. 0 = unlimited. */
  toolResultCap: number;
  /** How to handle previous-turn reasoning traces: "keep" | "drop". */
  reasoningTraceMode: "keep" | "drop";
  /** Remove low-value acknowledgment exchanges from assembled context. */
  ackPruning: boolean;
  /** Messages under this token count with no tool calls are ack candidates. */
  ackPruningMaxTokens: number;
  /** When false, passes chat_template_kwargs.enable_thinking=false to the summary model. Default: false. */
  summaryModelThinking: boolean;
  /** When set, write a JSONL debug entry for every summary model call (request + response) to this path. */
  summaryDebugLog: string;
};

/** Safely coerce an unknown value to a finite number, or return undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Safely coerce an unknown value to a boolean, or return undefined. */
function toBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Safely coerce an unknown value to a trimmed non-empty string, or return undefined. */
function toStr(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * Resolve LCM configuration with three-tier precedence:
 *   1. Environment variables (highest — backward compat)
 *   2. Plugin config object (from plugins.entries.lossless-claw.config)
 *   3. Hardcoded defaults (lowest)
 */
export function resolveLcmConfig(
  env: NodeJS.ProcessEnv = process.env,
  pluginConfig?: Record<string, unknown>,
): LcmConfig {
  const pc = pluginConfig ?? {};

  return {
    enabled:
      env.LCM_ENABLED !== undefined
        ? env.LCM_ENABLED !== "false"
        : toBool(pc.enabled) ?? true,
    databasePath:
      env.LCM_DATABASE_PATH
      ?? toStr(pc.dbPath)
      ?? toStr(pc.databasePath)
      ?? join(homedir(), ".openclaw", "lcm.db"),
    contextThreshold:
      (env.LCM_CONTEXT_THRESHOLD !== undefined ? parseFloat(env.LCM_CONTEXT_THRESHOLD) : undefined)
        ?? toNumber(pc.contextThreshold) ?? 0.75,
    freshTailCount:
      (env.LCM_FRESH_TAIL_COUNT !== undefined ? parseInt(env.LCM_FRESH_TAIL_COUNT, 10) : undefined)
        ?? toNumber(pc.freshTailCount) ?? 32,
    leafMinFanout:
      (env.LCM_LEAF_MIN_FANOUT !== undefined ? parseInt(env.LCM_LEAF_MIN_FANOUT, 10) : undefined)
        ?? toNumber(pc.leafMinFanout) ?? 8,
    condensedMinFanout:
      (env.LCM_CONDENSED_MIN_FANOUT !== undefined ? parseInt(env.LCM_CONDENSED_MIN_FANOUT, 10) : undefined)
        ?? toNumber(pc.condensedMinFanout) ?? 4,
    condensedMinFanoutHard:
      (env.LCM_CONDENSED_MIN_FANOUT_HARD !== undefined ? parseInt(env.LCM_CONDENSED_MIN_FANOUT_HARD, 10) : undefined)
        ?? toNumber(pc.condensedMinFanoutHard) ?? 2,
    incrementalMaxDepth:
      (env.LCM_INCREMENTAL_MAX_DEPTH !== undefined ? parseInt(env.LCM_INCREMENTAL_MAX_DEPTH, 10) : undefined)
        ?? toNumber(pc.incrementalMaxDepth) ?? 0,
    leafChunkTokens:
      (env.LCM_LEAF_CHUNK_TOKENS !== undefined ? parseInt(env.LCM_LEAF_CHUNK_TOKENS, 10) : undefined)
        ?? toNumber(pc.leafChunkTokens) ?? 20000,
    leafTargetTokens:
      (env.LCM_LEAF_TARGET_TOKENS !== undefined ? parseInt(env.LCM_LEAF_TARGET_TOKENS, 10) : undefined)
        ?? toNumber(pc.leafTargetTokens) ?? 1200,
    condensedTargetTokens:
      (env.LCM_CONDENSED_TARGET_TOKENS !== undefined ? parseInt(env.LCM_CONDENSED_TARGET_TOKENS, 10) : undefined)
        ?? toNumber(pc.condensedTargetTokens) ?? 2000,
    maxExpandTokens:
      (env.LCM_MAX_EXPAND_TOKENS !== undefined ? parseInt(env.LCM_MAX_EXPAND_TOKENS, 10) : undefined)
        ?? toNumber(pc.maxExpandTokens) ?? 4000,
    largeFileTokenThreshold:
      (env.LCM_LARGE_FILE_TOKEN_THRESHOLD !== undefined ? parseInt(env.LCM_LARGE_FILE_TOKEN_THRESHOLD, 10) : undefined)
        ?? toNumber(pc.largeFileThresholdTokens)
        ?? toNumber(pc.largeFileTokenThreshold)
        ?? 25000,
    largeFileSummaryProvider:
      env.LCM_LARGE_FILE_SUMMARY_PROVIDER?.trim() ?? toStr(pc.largeFileSummaryProvider) ?? "",
    largeFileSummaryModel:
      env.LCM_LARGE_FILE_SUMMARY_MODEL?.trim() ?? toStr(pc.largeFileSummaryModel) ?? "",
    autocompactDisabled:
      env.LCM_AUTOCOMPACT_DISABLED !== undefined
        ? env.LCM_AUTOCOMPACT_DISABLED === "true"
        : toBool(pc.autocompactDisabled) ?? false,
    timezone: env.TZ ?? toStr(pc.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    pruneHeartbeatOk:
      env.LCM_PRUNE_HEARTBEAT_OK !== undefined
        ? env.LCM_PRUNE_HEARTBEAT_OK === "true"
        : toBool(pc.pruneHeartbeatOk) ?? false,
    // ── Ozempic — Tier 1 engine features ──────────────────────────────────────
    pressureLoop:
      env.LCM_PRESSURE_LOOP !== undefined
        ? env.LCM_PRESSURE_LOOP !== "false"
        : toBool(pc.pressureLoop) ?? true,
    pressureMaxPasses:
      (env.LCM_PRESSURE_MAX_PASSES !== undefined
        ? parseInt(env.LCM_PRESSURE_MAX_PASSES, 10)
        : undefined) ?? toNumber(pc.pressureMaxPasses) ?? 3,
    freshTailTrimUnderPressure:
      env.LCM_FRESH_TAIL_TRIM_UNDER_PRESSURE !== undefined
        ? env.LCM_FRESH_TAIL_TRIM_UNDER_PRESSURE !== "false"
        : toBool(pc.freshTailTrimUnderPressure) ?? true,
    provenanceTyping:
      env.LCM_PROVENANCE_TYPING !== undefined
        ? env.LCM_PROVENANCE_TYPING !== "false"
        : toBool(pc.provenanceTyping) ?? true,
    provenanceEviction:
      env.LCM_PROVENANCE_EVICTION !== undefined
        ? env.LCM_PROVENANCE_EVICTION !== "false"
        : toBool(pc.provenanceEviction) ?? true,
    // ── Ozempic — Tier 2 heuristic features ───────────────────────────────────
    summaryMode:
      (env.LCM_SUMMARY_MODE as "always" | "on-demand" | "auto" | undefined) ??
      (toStr(pc.summaryMode) as "always" | "on-demand" | "auto" | undefined) ??
      "auto",
    toolResultCap:
      (env.LCM_TOOL_RESULT_CAP !== undefined ? parseInt(env.LCM_TOOL_RESULT_CAP, 10) : undefined) ??
      toNumber(pc.toolResultCap) ?? 400,
    reasoningTraceMode:
      (env.LCM_REASONING_TRACE_MODE as "keep" | "drop" | undefined) ??
      (toStr(pc.reasoningTraceMode) as "keep" | "drop" | undefined) ??
      "drop",
    ackPruning:
      env.LCM_ACK_PRUNING !== undefined
        ? env.LCM_ACK_PRUNING === "true"
        : toBool(pc.ackPruning) ?? false,
    ackPruningMaxTokens:
      (env.LCM_ACK_PRUNING_MAX_TOKENS !== undefined
        ? parseInt(env.LCM_ACK_PRUNING_MAX_TOKENS, 10)
        : undefined) ?? toNumber(pc.ackPruningMaxTokens) ?? 30,
    summaryModelThinking:
      env.LCM_SUMMARY_MODEL_THINKING !== undefined
        ? env.LCM_SUMMARY_MODEL_THINKING === "true"
        : toBool(pc.summaryModelThinking) ?? false,
    summaryDebugLog:
      env.LCM_SUMMARY_DEBUG_LOG?.trim() ?? toStr(pc.summaryDebugLog) ?? "",
  };
}
