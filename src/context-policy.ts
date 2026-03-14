import { readFileSync } from "node:fs";
import { classifyToolProvenance, type ProvenanceKind } from "./context-manifest.js";
import { resolveSessionStateConfig, type SessionStateConfig } from "./session-state.js";

// ── Context policy types ───────────────────────────────────────────────────────

export interface ToolResultCompactionRule {
  /** Regex or plain string matched against the tool name. */
  toolNamePattern: string;
  /** JSON field names to extract. If omitted, falls through to truncation. */
  extractFields?: string[];
  /** Max tokens after extraction. Falls back to truncation if still exceeded. */
  maxTokens: number;
}

export interface ContextPolicy {
  /** Tier 1/2 config overrides (handled by engine config resolution, not here). */
  overrides?: Record<string, unknown>;

  toolResultCompaction?: {
    rules: ToolResultCompactionRule[];
  };

  /** Resolved session state config (populated by loadContextPolicy). */
  sessionState?: SessionStateConfig | null;

  toolClassification?: {
    observed?: string[];
    computed?: string[];
    mutation?: string[];
  };

  freshnessTtl?: {
    /** Default TTL in seconds for all observed tool results. */
    default?: number;
    /** Per-tool TTL overrides (seconds). */
    byTool?: Record<string, number>;
  };
}

// ── Policy loader ─────────────────────────────────────────────────────────────

/**
 * Load and parse a context-policy.json file.
 * Returns null if the file does not exist or cannot be parsed.
 * Always fail-open — a bad policy file disables Tier 3, it never breaks assembly.
 */
export function loadContextPolicy(policyPath: string): ContextPolicy | null {
  try {
    const raw = readFileSync(policyPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const policy = parsed as ContextPolicy;
    // Resolve sessionState config so consumers get a typed object (or null).
    policy.sessionState = resolveSessionStateConfig(
      (parsed as Record<string, unknown>).sessionState,
    );
    return policy;
  } catch {
    return null;
  }
}

// ── Custom tool classification ────────────────────────────────────────────────

/**
 * Resolve provenance for a tool name using per-agent policy overrides.
 * Falls back to the default heuristic classifier when no policy entry matches.
 */
export function resolveToolProvenanceWithPolicy(
  toolName: string,
  policy: ContextPolicy | null,
): ProvenanceKind {
  if (policy?.toolClassification) {
    const cls = policy.toolClassification;
    if (cls.mutation?.some((name) => toolName === name || toolName.includes(name))) {
      return "mutation";
    }
    if (cls.computed?.some((name) => toolName === name || toolName.includes(name))) {
      return "computed";
    }
    if (cls.observed?.some((name) => toolName === name || toolName.includes(name))) {
      return "observed";
    }
  }
  return classifyToolProvenance(toolName);
}

// ── Freshness TTL ─────────────────────────────────────────────────────────────

/**
 * Return the TTL (in seconds) for an observed tool result, or null if no TTL is configured.
 */
export function getTtlSeconds(
  toolName: string | undefined,
  policy: ContextPolicy | null,
): number | null {
  const ttl = policy?.freshnessTtl;
  if (!ttl) return null;

  if (toolName && ttl.byTool && Object.prototype.hasOwnProperty.call(ttl.byTool, toolName)) {
    const perTool = ttl.byTool[toolName];
    return typeof perTool === "number" && perTool > 0 ? perTool : null;
  }

  return typeof ttl.default === "number" && ttl.default > 0 ? ttl.default : null;
}

/**
 * Return true if the observed result is past its freshness TTL.
 */
export function isFreshnessExpired(
  createdAt: Date | undefined,
  toolName: string | undefined,
  policy: ContextPolicy | null,
): boolean {
  if (!createdAt) return false;
  const ttlSec = getTtlSeconds(toolName, policy);
  if (ttlSec === null) return false;
  const ageMs = Date.now() - createdAt.getTime();
  return ageMs > ttlSec * 1000;
}

// ── Tool result compaction rules ──────────────────────────────────────────────

/** Simple token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Find the first compaction rule whose toolNamePattern matches the given tool name.
 * Pattern matching: exact equality or substring match. For regex, the pattern is
 * wrapped in a try/catch so a malformed regex silently falls through.
 */
function findMatchingRule(
  toolName: string,
  rules: ToolResultCompactionRule[],
): ToolResultCompactionRule | null {
  for (const rule of rules) {
    try {
      if (new RegExp(rule.toolNamePattern).test(toolName)) {
        return rule;
      }
    } catch {
      // Malformed regex — try plain substring match
      if (toolName.includes(rule.toolNamePattern)) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * Extract listed fields from a JSON object and return the result as a
 * compact JSON string. Returns null if parsing fails or no fields match.
 */
function extractJsonFields(
  text: string,
  fields: string[],
): string | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const extracted: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(parsed, field)) {
        extracted[field] = (parsed as Record<string, unknown>)[field];
      }
    }
    if (Object.keys(extracted).length === 0) return null;
    return JSON.stringify(extracted);
  } catch {
    return null;
  }
}

/**
 * Apply tool result compaction rules to a single tool result text.
 *
 * Priority:
 * 1. If a compaction rule matches: extract fields (if specified) and enforce maxTokens.
 * 2. If no rule matches: apply the fallback Tier 2 cap (0 = no cap).
 *
 * Always fail-open: if field extraction fails, fall back to plain truncation.
 */
export function applyCompactionRules(
  toolName: string,
  text: string,
  policy: ContextPolicy | null,
  fallbackCapTokens: number,
): string {
  const rules = policy?.toolResultCompaction?.rules;
  const rule = rules && rules.length > 0 ? findMatchingRule(toolName, rules) : null;

  if (rule) {
    // Try field extraction first
    let candidate = text;
    if (rule.extractFields && rule.extractFields.length > 0) {
      const extracted = extractJsonFields(text, rule.extractFields);
      if (extracted !== null) {
        candidate = extracted;
      }
      // If extraction failed, candidate stays as original text — truncation below handles it
    }
    // Enforce maxTokens
    if (estimateTokens(candidate) > rule.maxTokens) {
      const maxChars = rule.maxTokens * 4;
      candidate =
        candidate.slice(0, maxChars) +
        `\n[... truncated by Ozempic compaction rule (maxTokens=${rule.maxTokens})]`;
    }
    return candidate;
  }

  // No matching rule — apply Tier 2 fallback cap
  if (fallbackCapTokens > 0 && estimateTokens(text) > fallbackCapTokens) {
    const maxChars = fallbackCapTokens * 4;
    const tokenEstimate = estimateTokens(text);
    return (
      text.slice(0, maxChars) +
      `\n[... truncated — ${tokenEstimate - fallbackCapTokens} tokens omitted by Ozempic toolResultCap]`
    );
  }

  return text;
}
