import type { KnowledgeStore } from "./store/knowledge-store.js";
import type { SemanticSearchConfig } from "./semantic-search.js";
import { semanticSearch } from "./semantic-search.js";

export type KnowledgeSearchHit = {
  packId: string;
  chunkId: string;
  documentId: string;
  heading: string | null;
  sectionPath: string | null;
  excerpt: string;
  fullContent: string;
  tokenCount: number;
  score: number;
  method: "semantic" | "lexical";
};

function buildExcerpt(content: string, query: string, capTokens: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const maxChars = Math.max(120, capTokens * 4);
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return normalized.length > maxChars
      ? `${normalized.slice(0, maxChars)}\n[... excerpt truncated by retrievalResultCap]`
      : normalized;
  }
  const idx = normalized.toLowerCase().indexOf(needle);
  if (idx === -1) {
    return normalized.length > maxChars
      ? `${normalized.slice(0, maxChars)}\n[... excerpt truncated by retrievalResultCap]`
      : normalized;
  }
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(normalized.length, start + maxChars);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function lexicalScore(content: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = content.toLowerCase();
  const idx = hay.indexOf(q);
  if (idx >= 0) return 10_000 - idx;
  const terms = q.split(/\s+/).filter(Boolean);
  return terms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
}

export async function searchKnowledgePacks(input: {
  store: KnowledgeStore;
  query: string;
  packIds: string[];
  semanticConfig?: SemanticSearchConfig | null;
  limit?: number;
  resultTokenCap?: number;
}): Promise<KnowledgeSearchHit[]> {
  const limit = Math.max(1, Math.trunc(input.limit ?? 8));
  const resultTokenCap = Math.max(50, Math.trunc(input.resultTokenCap ?? 220));
  const chunks = input.store.listChunksForPacks(input.packIds);
  if (chunks.length === 0) return [];

  const embeddingModel = input.semanticConfig?.embedding?.model;
  if (input.semanticConfig && embeddingModel) {
    const candidates = input.store.getChunkCandidatesForPacks(input.packIds, embeddingModel).map((entry) => ({
      summaryId: entry.chunkId,
      content: entry.content,
      embedding: entry.embedding,
    }));
    if (candidates.length > 0) {
      const byChunkId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
      const semanticHits = await semanticSearch({
        query: input.query,
        candidates,
        config: input.semanticConfig,
        topK: limit,
      });
      return semanticHits
        .map((hit) => {
          const chunk = byChunkId.get(hit.summaryId);
          if (!chunk) return null;
          return {
            packId: chunk.packId,
            chunkId: chunk.chunkId,
            documentId: chunk.documentId,
            heading: chunk.heading,
            sectionPath: chunk.sectionPath,
            excerpt: buildExcerpt(chunk.content, input.query, resultTokenCap),
            fullContent: chunk.content,
            tokenCount: chunk.tokenCount,
            score: hit.score,
            method: "semantic" as const,
          };
        })
        .filter((value): value is KnowledgeSearchHit => value != null);
    }
  }

  return chunks
    .map((chunk) => ({ chunk, score: lexicalScore(chunk.content, input.query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      packId: chunk.packId,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      heading: chunk.heading,
      sectionPath: chunk.sectionPath,
      excerpt: buildExcerpt(chunk.content, input.query, resultTokenCap),
      fullContent: chunk.content,
      tokenCount: chunk.tokenCount,
      score,
      method: "lexical" as const,
    }));
}
