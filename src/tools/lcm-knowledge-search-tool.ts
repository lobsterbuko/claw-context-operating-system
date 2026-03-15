import { Type } from "@sinclair/typebox";
import type { LcmContextEngine } from "../engine.js";
import { searchKnowledgePacks } from "../knowledge-retrieval.js";
import type { LcmDependencies } from "../types.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const LcmKnowledgeSearchSchema = Type.Object({
  query: Type.String({
    description: "Search query for mounted or active knowledge packs.",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of results to return. Default: 6.", minimum: 1, maximum: 20 }),
  ),
  resultTokenCap: Type.Optional(
    Type.Number({ description: "Approximate per-result token cap for excerpts. Default: 220.", minimum: 50, maximum: 1000 }),
  ),
  packIds: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional explicit pack ids to search instead of the current mounted/active set.",
    }),
  ),
});

export function createLcmKnowledgeSearchTool(input: {
  deps: LcmDependencies;
  lcm: LcmContextEngine;
  sessionId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    name: "lcm_knowledge_search",
    label: "LCM Knowledge Search",
    description:
      "Search imported Knowledge Packs mounted to the current agent. " +
      "Uses semantic retrieval when embeddings are available, otherwise lexical matching. " +
      "Returns compact source-aware excerpts suitable for immediate use.",
    parameters: LcmKnowledgeSearchSchema,
    async execute(_toolCallId, params) {
      const p = params as Record<string, unknown>;
      try {
        const query = readStringParam(p, "query", { required: true, label: "query" })!;
        const parsed = input.deps.parseAgentSessionKey(input.sessionKey ?? "");
        const agentId = input.deps.normalizeAgentId(parsed?.agentId);
        const store = input.lcm.getKnowledgeStore();
        const explicitPackIds = Array.isArray(p.packIds)
          ? p.packIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const mounted = store.listMountedPacks(agentId, true);
        const packIds =
          explicitPackIds.length > 0
            ? explicitPackIds
            : mounted.map((entry) => entry.packId);

        if (packIds.length === 0) {
          return jsonResult({
            ok: false,
            error: "No Knowledge Packs are mounted or active for this agent.",
          });
        }

        const searchConfig = input.lcm.getSearchConfig(input.sessionId, input.sessionKey).searchConfig;
        const hits = await searchKnowledgePacks({
          store,
          query,
          packIds,
          semanticConfig: searchConfig,
          limit: typeof p.limit === "number" ? Math.trunc(p.limit) : undefined,
          resultTokenCap: typeof p.resultTokenCap === "number" ? Math.trunc(p.resultTokenCap) : undefined,
        });

        const lines: string[] = [];
        lines.push("## Knowledge Search Results");
        lines.push(`**Query:** ${query}`);
        lines.push(`**Packs:** ${packIds.join(", ")}`);
        lines.push("");
        if (hits.length === 0) {
          lines.push("No matches found.");
        } else {
          hits.forEach((hit, index) => {
            lines.push(`### ${index + 1}. ${hit.heading ?? hit.sectionPath ?? hit.chunkId}`);
            lines.push(
              `pack=${hit.packId} document=${hit.documentId} chunk=${hit.chunkId} method=${hit.method} score=${hit.score.toFixed(3)}`,
            );
            if (hit.sectionPath) {
              lines.push(`section=${hit.sectionPath}`);
            }
            lines.push(hit.excerpt);
            lines.push("");
          });
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { ok: true, query, packIds, hits },
        };
      } catch (error) {
        return jsonResult({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
