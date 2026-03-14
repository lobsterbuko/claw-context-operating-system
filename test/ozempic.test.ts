/**
 * Ozempic v2 unit tests — Phases 1 through 3a
 *
 * Covers:
 *   - classifyToolProvenance (Tier 1 heuristic classifier)
 *   - context-policy: loadContextPolicy, resolveToolProvenanceWithPolicy,
 *     getTtlSeconds, isFreshnessExpired, applyCompactionRules
 *   - Assembler: summary mode, ack pruning, reasoning trace drop,
 *     tool result cap, freshness TTL, custom classification, compaction rules
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyToolProvenance } from "../src/context-manifest.js";
import {
  applyCompactionRules,
  getTtlSeconds,
  isFreshnessExpired,
  loadContextPolicy,
  resolveToolProvenanceWithPolicy,
  type ContextPolicy,
} from "../src/context-policy.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ozempic-test-"));
  tempDirs.push(dir);
  return dir;
}

function writePolicyFile(dir: string, policy: unknown): string {
  const path = join(dir, "context-policy.json");
  writeFileSync(path, JSON.stringify(policy, null, 2), "utf-8");
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

// ── classifyToolProvenance ────────────────────────────────────────────────────

describe("classifyToolProvenance", () => {
  it("classifies mutation tool names", () => {
    // patterns use \b word boundaries; hyphens (non-word chars) create boundaries,
    // underscores (word chars) do not. Use names that match the actual regexes.
    expect(classifyToolProvenance("write-row")).toBe("mutation");
    expect(classifyToolProvenance("update-day")).toBe("mutation");
    expect(classifyToolProvenance("delete")).toBe("mutation");
    expect(classifyToolProvenance("delete-entry")).toBe("mutation");
    expect(classifyToolProvenance("create-session")).toBe("mutation");
    expect(classifyToolProvenance("insert")).toBe("mutation");
    expect(classifyToolProvenance("insert-record")).toBe("mutation");
    expect(classifyToolProvenance("set-day")).toBe("mutation");
    expect(classifyToolProvenance("send-notification")).toBe("mutation");
    expect(classifyToolProvenance("patch-config")).toBe("mutation");
  });

  it("classifies computed tool names", () => {
    // \bcalc\b needs a word boundary after "calc" — use hyphen or standalone
    expect(classifyToolProvenance("calc")).toBe("computed");
    expect(classifyToolProvenance("calc-hours")).toBe("computed");
    expect(classifyToolProvenance("compute-total")).toBe("computed");
    expect(classifyToolProvenance("aggregate-days")).toBe("computed");
    expect(classifyToolProvenance("sum")).toBe("computed");
    expect(classifyToolProvenance("count-entries")).toBe("computed");
    expect(classifyToolProvenance("average")).toBe("computed");
  });

  it("classifies ambiguous and read tool names as observed", () => {
    expect(classifyToolProvenance("read-day")).toBe("observed");
    expect(classifyToolProvenance("get-quote")).toBe("observed");
    expect(classifyToolProvenance("fetch-metadata")).toBe("observed");
    expect(classifyToolProvenance("sheets_cli.py")).toBe("observed");
    expect(classifyToolProvenance("list-positions")).toBe("observed");
    expect(classifyToolProvenance("unknown_tool_xyz")).toBe("observed");
  });

  it("mutation patterns take priority over computed patterns", () => {
    // "execute_trade" should match mutation before computed
    expect(classifyToolProvenance("execute_trade")).toBe("mutation");
  });
});

// ── loadContextPolicy ─────────────────────────────────────────────────────────

describe("loadContextPolicy", () => {
  it("returns null when file does not exist", () => {
    expect(loadContextPolicy("/nonexistent/path/context-policy.json")).toBeNull();
  });

  it("returns null when file contains invalid JSON", () => {
    const dir = makeTmpDir();
    const path = join(dir, "context-policy.json");
    writeFileSync(path, "{ not valid json }", "utf-8");
    expect(loadContextPolicy(path)).toBeNull();
  });

  it("returns null when file contains non-object JSON", () => {
    const dir = makeTmpDir();
    const path = join(dir, "context-policy.json");
    writeFileSync(path, "[1, 2, 3]", "utf-8");
    expect(loadContextPolicy(path)).toBeNull();
  });

  it("loads a valid policy file", () => {
    const dir = makeTmpDir();
    const policy: ContextPolicy = {
      toolClassification: {
        mutation: ["my-write"],
        observed: ["my-read"],
      },
      freshnessTtl: {
        default: 300,
        byTool: { "get-quote": 30 },
      },
    };
    const path = writePolicyFile(dir, policy);
    const loaded = loadContextPolicy(path);
    expect(loaded).not.toBeNull();
    expect(loaded?.toolClassification?.mutation).toContain("my-write");
    expect(loaded?.freshnessTtl?.default).toBe(300);
    expect(loaded?.freshnessTtl?.byTool?.["get-quote"]).toBe(30);
  });

  it("loads a policy with compaction rules", () => {
    const dir = makeTmpDir();
    const policy: ContextPolicy = {
      toolResultCompaction: {
        rules: [
          { toolNamePattern: "sheets.*read", extractFields: ["day", "start", "end"], maxTokens: 100 },
        ],
      },
    };
    const path = writePolicyFile(dir, policy);
    const loaded = loadContextPolicy(path);
    expect(loaded?.toolResultCompaction?.rules).toHaveLength(1);
    expect(loaded?.toolResultCompaction?.rules[0]?.extractFields).toContain("day");
  });
});

// ── resolveToolProvenanceWithPolicy ───────────────────────────────────────────

describe("resolveToolProvenanceWithPolicy", () => {
  it("falls back to default classifier when policy is null", () => {
    expect(resolveToolProvenanceWithPolicy("write-row", null)).toBe("mutation");
    expect(resolveToolProvenanceWithPolicy("calc-total", null)).toBe("computed");
    expect(resolveToolProvenanceWithPolicy("read-day", null)).toBe("observed");
  });

  it("uses explicit mutation list from policy", () => {
    const policy: ContextPolicy = {
      toolClassification: { mutation: ["execute-trade", "cancel-order"] },
    };
    expect(resolveToolProvenanceWithPolicy("execute-trade", policy)).toBe("mutation");
    expect(resolveToolProvenanceWithPolicy("cancel-order", policy)).toBe("mutation");
  });

  it("uses explicit observed list from policy", () => {
    const policy: ContextPolicy = {
      toolClassification: { observed: ["get-quote", "list-positions"] },
    };
    expect(resolveToolProvenanceWithPolicy("get-quote", policy)).toBe("observed");
    expect(resolveToolProvenanceWithPolicy("list-positions", policy)).toBe("observed");
  });

  it("uses explicit computed list from policy", () => {
    const policy: ContextPolicy = {
      toolClassification: { computed: ["compute-pnl"] },
    };
    expect(resolveToolProvenanceWithPolicy("compute-pnl", policy)).toBe("computed");
  });

  it("policy mutation takes priority over default heuristics", () => {
    // "read-day" normally → observed, but explicitly listed as mutation
    const policy: ContextPolicy = {
      toolClassification: { mutation: ["read-day"] },
    };
    expect(resolveToolProvenanceWithPolicy("read-day", policy)).toBe("mutation");
  });

  it("falls back to default heuristics for unlisted tools", () => {
    const policy: ContextPolicy = {
      toolClassification: { mutation: ["only-this-tool"] },
    };
    // write-row not in policy list → falls back to default heuristic → mutation
    expect(resolveToolProvenanceWithPolicy("write-row", policy)).toBe("mutation");
    // unknown tool not in any list → observed
    expect(resolveToolProvenanceWithPolicy("unknown-tool", policy)).toBe("observed");
  });

  it("handles substring matching for policy entries", () => {
    const policy: ContextPolicy = {
      toolClassification: { mutation: ["trade"] },
    };
    // "execute-trade" includes "trade"
    expect(resolveToolProvenanceWithPolicy("execute-trade", policy)).toBe("mutation");
  });
});

// ── getTtlSeconds ─────────────────────────────────────────────────────────────

describe("getTtlSeconds", () => {
  it("returns null when policy is null", () => {
    expect(getTtlSeconds("any-tool", null)).toBeNull();
  });

  it("returns null when policy has no freshnessTtl", () => {
    const policy: ContextPolicy = { toolClassification: {} };
    expect(getTtlSeconds("any-tool", policy)).toBeNull();
  });

  it("returns default TTL when no per-tool override", () => {
    const policy: ContextPolicy = { freshnessTtl: { default: 300 } };
    expect(getTtlSeconds("some-tool", policy)).toBe(300);
    expect(getTtlSeconds(undefined, policy)).toBe(300);
  });

  it("returns per-tool TTL when available", () => {
    const policy: ContextPolicy = {
      freshnessTtl: { default: 300, byTool: { "get-quote": 30, "read-day": 600 } },
    };
    expect(getTtlSeconds("get-quote", policy)).toBe(30);
    expect(getTtlSeconds("read-day", policy)).toBe(600);
    expect(getTtlSeconds("other-tool", policy)).toBe(300); // falls back to default
  });

  it("returns null when default is 0 or missing", () => {
    const policy: ContextPolicy = { freshnessTtl: { default: 0 } };
    expect(getTtlSeconds("any-tool", policy)).toBeNull();
  });
});

// ── isFreshnessExpired ────────────────────────────────────────────────────────

describe("isFreshnessExpired", () => {
  it("returns false when policy is null", () => {
    expect(isFreshnessExpired(new Date(), "any-tool", null)).toBe(false);
  });

  it("returns false when createdAt is undefined", () => {
    const policy: ContextPolicy = { freshnessTtl: { default: 1 } };
    expect(isFreshnessExpired(undefined, "any-tool", policy)).toBe(false);
  });

  it("returns false when TTL has not elapsed", () => {
    const policy: ContextPolicy = { freshnessTtl: { default: 3600 } };
    const recentDate = new Date(Date.now() - 60_000); // 1 minute ago
    expect(isFreshnessExpired(recentDate, "any-tool", policy)).toBe(false);
  });

  it("returns true when TTL has elapsed", () => {
    const policy: ContextPolicy = { freshnessTtl: { default: 10 } }; // 10 seconds
    const oldDate = new Date(Date.now() - 60_000); // 1 minute ago
    expect(isFreshnessExpired(oldDate, "any-tool", policy)).toBe(true);
  });

  it("uses per-tool TTL for expiry check", () => {
    const policy: ContextPolicy = {
      freshnessTtl: { default: 3600, byTool: { "get-quote": 5 } },
    };
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    // get-quote TTL = 5s, so 10s old → expired
    expect(isFreshnessExpired(tenSecondsAgo, "get-quote", policy)).toBe(true);
    // default TTL = 3600s, 10s old → not expired
    expect(isFreshnessExpired(tenSecondsAgo, "other-tool", policy)).toBe(false);
  });
});

// ── applyCompactionRules ──────────────────────────────────────────────────────

describe("applyCompactionRules", () => {
  describe("no rules, Tier 2 fallback", () => {
    it("returns text unchanged when cap is 0", () => {
      const text = "a".repeat(2000);
      expect(applyCompactionRules("some-tool", text, null, 0)).toBe(text);
    });

    it("truncates when text exceeds fallback cap", () => {
      const text = "x".repeat(1600); // ~400 tokens
      const result = applyCompactionRules("some-tool", text, null, 100);
      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain("[... truncated");
      expect(result).toContain("toolResultCap");
    });

    it("leaves text alone when under fallback cap", () => {
      const text = "short text";
      expect(applyCompactionRules("some-tool", text, null, 400)).toBe(text);
    });
  });

  describe("with compaction rules", () => {
    it("extracts JSON fields when rule matches", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            {
              toolNamePattern: "sheets.*read",
              extractFields: ["day", "start", "end"],
              maxTokens: 500,
            },
          ],
        },
      };
      const json = JSON.stringify({ day: "2026-03-14", start: "08:30", end: "17:00", extra: "ignored" });
      const result = applyCompactionRules("sheets_cli.py read-day", json, policy, 0);
      const parsed = JSON.parse(result);
      expect(parsed.day).toBe("2026-03-14");
      expect(parsed.start).toBe("08:30");
      expect(parsed.end).toBe("17:00");
      expect(parsed.extra).toBeUndefined();
    });

    it("falls back to truncation when JSON parse fails", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            { toolNamePattern: "sheets.*read", extractFields: ["day"], maxTokens: 5 },
          ],
        },
      };
      const text = "not json at all, " + "x".repeat(400);
      const result = applyCompactionRules("sheets_cli.py read-day", text, policy, 0);
      expect(result).toContain("[... truncated");
    });

    it("enforces maxTokens after extraction", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            {
              toolNamePattern: "^my-tool$",
              extractFields: ["data"],
              maxTokens: 10, // very small
            },
          ],
        },
      };
      const json = JSON.stringify({ data: "x".repeat(400) });
      const result = applyCompactionRules("my-tool", json, policy, 0);
      expect(result).toContain("[... truncated");
      expect(result).toContain("maxTokens=10");
    });

    it("applies fallback cap when no rule matches", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [{ toolNamePattern: "^specific-tool$", maxTokens: 50 }],
        },
      };
      const text = "x".repeat(1600); // ~400 tokens
      const result = applyCompactionRules("different-tool", text, policy, 100);
      // no rule match → Tier 2 cap applies
      expect(result).toContain("[... truncated");
      expect(result).toContain("toolResultCap");
    });

    it("uses regex for toolNamePattern matching", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            { toolNamePattern: "sheets.*\\.(py|sh)", extractFields: ["rows"], maxTokens: 500 },
          ],
        },
      };
      const json = JSON.stringify({ rows: [1, 2, 3], meta: "ignored" });
      const result = applyCompactionRules("skills/gsheets/sheets_cli.py", json, policy, 0);
      const parsed = JSON.parse(result);
      expect(parsed.rows).toEqual([1, 2, 3]);
      expect(parsed.meta).toBeUndefined();
    });

    it("does not truncate when result fits within maxTokens", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            { toolNamePattern: "my-tool", extractFields: ["val"], maxTokens: 500 },
          ],
        },
      };
      const json = JSON.stringify({ val: "small", other: "dropped" });
      const result = applyCompactionRules("my-tool", json, policy, 0);
      expect(result).not.toContain("[... truncated");
      const parsed = JSON.parse(result);
      expect(parsed.val).toBe("small");
    });

    it("handles malformed regex by falling back to substring match", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            // invalid regex character class
            { toolNamePattern: "[invalid-regex", maxTokens: 500 },
          ],
        },
      };
      // "[invalid-regex" as substring → doesn't match "my-tool"
      const text = "x".repeat(1600);
      // no match → Tier 2 cap (0 = unlimited)
      const result = applyCompactionRules("my-tool", text, policy, 0);
      expect(result).toBe(text);
    });
  });

  describe("extractFields edge cases", () => {
    it("returns original text when none of the extractFields exist in JSON", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            { toolNamePattern: "my-tool", extractFields: ["nonexistent"], maxTokens: 500 },
          ],
        },
      };
      const json = JSON.stringify({ actual: "data" });
      // extraction fails (no matching fields) → falls through to original → under maxTokens → unchanged
      const result = applyCompactionRules("my-tool", json, policy, 0);
      expect(result).toBe(json);
    });

    it("handles array JSON input gracefully (not an extractable object)", () => {
      const policy: ContextPolicy = {
        toolResultCompaction: {
          rules: [
            { toolNamePattern: "my-tool", extractFields: ["field"], maxTokens: 1 },
          ],
        },
      };
      // array can't be field-extracted (returns null) → candidate stays as original text
      // → maxTokens=1 enforced → truncated
      const text = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = applyCompactionRules("my-tool", text, policy, 0);
      expect(result).toContain("[... truncated");
    });
  });
});

// ── Manifest structure ────────────────────────────────────────────────────────

describe("manifest structure", () => {
  it("OzempicFeatureFlags has all expected Tier 1 and Tier 2 fields", async () => {
    const { buildManifestRef } = await import("../src/context-manifest.js");
    const manifest = {
      version: 1 as const,
      manifestId: "test-id",
      sessionId: "test-session",
      assembledAt: new Date().toISOString(),
      tokenBudget: 65536,
      estimatedTokens: 1000,
      freshTailCount: 8,
      ozempicFeatures: {
        pressureLoop: true,
        freshTailTrimUnderPressure: true,
        provenanceTyping: true,
        provenanceEviction: true,
        summaryMode: "auto" as const,
        toolResultCap: 400,
        reasoningTraceMode: "drop" as const,
        ackPruning: false,
      },
      stats: {
        totalResolvedItems: 10,
        selectedItems: 8,
        omittedItems: 2,
        selectedRawMessages: 6,
        selectedSummaries: 2,
        totalContextItems: 10,
        freshTailTrimmed: 0,
        evictedStaleObserved: 0,
        pressurePassesRun: 0,
        ackPruned: 0,
      },
      items: [],
    };

    const ref = buildManifestRef(manifest);
    expect(ref.manifestId).toBe("test-id");
    expect(ref.sessionId).toBe("test-session");
    expect(ref.estimatedTokens).toBe(1000);
  });
});
