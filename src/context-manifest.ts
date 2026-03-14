import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Provenance types ──────────────────────────────────────────────────────────

export type ProvenanceKind =
  | "observed"
  | "computed"
  | "mutation"
  | "user_prompt"
  | "assistant_answer"
  | "summary";

// ── Manifest types ────────────────────────────────────────────────────────────

export interface ManifestItem {
  ordinal: number;
  sourceType: "message" | "summary";
  runtimeRole: string;
  estimatedTokens: number;
  provenance?: {
    kind: ProvenanceKind;
    toolName?: string;
  };
  protectedByFreshTail: boolean;
}

export interface OzempicFeatureFlags {
  pressureLoop: boolean;
  freshTailTrimUnderPressure: boolean;
  provenanceTyping: boolean;
  provenanceEviction: boolean;
  // Tier 2
  summaryMode: "always" | "on-demand" | "auto";
  toolResultCap: number;
  reasoningTraceMode: "keep" | "drop";
  ackPruning: boolean;
}

export interface ContextManifest {
  version: 1;
  manifestId: string;
  sessionId: string;
  assembledAt: string;
  tokenBudget: number;
  estimatedTokens: number;
  freshTailCount: number;
  ozempicFeatures: OzempicFeatureFlags;
  stats: {
    totalResolvedItems: number;
    selectedItems: number;
    omittedItems: number;
    selectedRawMessages: number;
    selectedSummaries: number;
    totalContextItems: number;
    freshTailTrimmed: number;
    evictedStaleObserved: number;
    pressurePassesRun: number;
    ackPruned: number;
  };
  items: ManifestItem[];
}

export interface ContextManifestRef {
  manifestId: string;
  sessionId: string;
  assembledAt: string;
  estimatedTokens: number;
}

// ── Provenance classification ─────────────────────────────────────────────────

const MUTATION_PATTERNS = [
  /\bwrite[\-_]?row\b/i,
  /\bset[\-_]?day\b/i,
  /\bset[\-_]?row\b/i,
  /\bwrite\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bcreate\b/i,
  /\binsert\b/i,
  /\bexecute[\-_]?trade\b/i,
  /\bplace[\-_]?order\b/i,
  /\bcancel[\-_]?order\b/i,
  /\bsend\b/i,
  /\bpatch\b/i,
];

const COMPUTE_PATTERNS = [
  /\bcalc\b/i,
  /\bcompute\b/i,
  /\bsum\b/i,
  /\baggregate[\-_]?days\b/i,
  /\baggregate\b/i,
  /\btotal\b/i,
  /\bcount\b/i,
  /\baverage\b/i,
];

/**
 * Classify a tool result's provenance kind from the tool name.
 * Falls back to "observed" for ambiguous or unknown tool names.
 */
export function classifyToolProvenance(toolName: string): ProvenanceKind {
  if (MUTATION_PATTERNS.some((p) => p.test(toolName))) return "mutation";
  if (COMPUTE_PATTERNS.some((p) => p.test(toolName))) return "computed";
  return "observed";
}

// ── Manifest I/O ──────────────────────────────────────────────────────────────

/** Default manifest directory. */
export function defaultManifestDir(): string {
  return join(homedir(), ".openclaw", "aeon", "manifests");
}

/**
 * Write a context manifest to disk.
 * Only the latest manifest per session is kept (overwritten each turn).
 * Manifest writes are best-effort — failures are silently swallowed.
 */
export async function writeContextManifest(
  manifest: ContextManifest,
  manifestDir: string = defaultManifestDir(),
): Promise<void> {
  try {
    await mkdir(manifestDir, { recursive: true });
    const filename = join(manifestDir, `${manifest.sessionId}.latest.json`);
    await writeFile(filename, JSON.stringify(manifest, null, 2), "utf-8");
  } catch {
    // Best-effort — never crash assembly.
  }
}

/** Build a compact manifest reference for storage in sheriffMeta or elsewhere. */
export function buildManifestRef(manifest: ContextManifest): ContextManifestRef {
  return {
    manifestId: manifest.manifestId,
    sessionId: manifest.sessionId,
    assembledAt: manifest.assembledAt,
    estimatedTokens: manifest.estimatedTokens,
  };
}
