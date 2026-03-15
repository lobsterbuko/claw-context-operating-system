/**
 * Semantic Search — Ozempic Tier 3 extension
 *
 * Provides embedding-based vector search and LLM-based reranking for
 * lcm_grep. The pipeline:
 *
 *   1. At compaction time: embed each new summary and store the vector.
 *   2. At query time:
 *      a. Embed the query via /v1/embeddings.
 *      b. Cosine-similarity scan over stored summary vectors → top N candidates.
 *      c. Reranker scores via /v1/rerank (native oMLX endpoint) → re-sort → top K.
 *
 * Both are fire-and-forget-safe: failures log and fall back to FTS5.
 */
import {
  buildHttpUsageRequest,
  createUsageLogRequestId,
  writeLlmUsageLog,
} from "./llm-usage-log.js";

// ── Config types ──────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  /** Full base URL of the embedding model endpoint, e.g. "http://mac-mini:8005/v1" */
  baseUrl: string;
  /** API key (may be a placeholder like "Decoy") */
  apiKey?: string;
  /** Model name as registered on the server, e.g. "embed" */
  model: string;
  /** Output dimensions (default: 1024) */
  dimensions?: number;
  /**
   * Task instruction prefix for queries (NOT used for documents).
   * Format: "Instruct: {taskInstruction}\nQuery:{query}"
   * Documents are embedded without any prefix.
   */
  taskInstruction?: string;
}

export interface RerankerConfig {
  /** Full base URL of the reranker endpoint, e.g. "http://mac-mini:8005/v1" */
  baseUrl: string;
  /** API key (may be a placeholder like "Decoy") */
  apiKey?: string;
  /** Model name as registered on the server */
  model: string;
  /**
   * Task instruction describing what "relevant" means for this agent.
   * e.g. "Given a user query about past conversation history, judge whether
   * this summary is relevant and useful to answer the query."
   */
  taskInstruction?: string;
  /** How many FTS5 candidates to pass to the reranker (default: 30) */
  maxCandidates?: number;
  /** How many reranked results to return (default: 8) */
  topK?: number;
}

export interface SemanticSearchConfig {
  embedding: EmbeddingConfig;
  reranker?: RerankerConfig;
}

// ── Config resolver ───────────────────────────────────────────────────────────

export function resolveSemanticSearchConfig(
  raw: unknown,
): SemanticSearchConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const emb = r.embedding;
  if (!emb || typeof emb !== "object" || Array.isArray(emb)) return null;
  const e = emb as Record<string, unknown>;

  if (typeof e.baseUrl !== "string" || !e.baseUrl.trim()) return null;
  if (typeof e.model !== "string" || !e.model.trim()) return null;

  const embedding: EmbeddingConfig = {
    baseUrl: e.baseUrl.trim().replace(/\/$/, ""),
    model: e.model.trim(),
    ...(typeof e.apiKey === "string" && { apiKey: e.apiKey }),
    ...(typeof e.dimensions === "number" && { dimensions: e.dimensions }),
    ...(typeof e.taskInstruction === "string" && {
      taskInstruction: e.taskInstruction,
    }),
  };

  let reranker: RerankerConfig | undefined;
  const rnk = r.reranker;
  if (rnk && typeof rnk === "object" && !Array.isArray(rnk)) {
    const rr = rnk as Record<string, unknown>;
    if (typeof rr.baseUrl === "string" && typeof rr.model === "string") {
      reranker = {
        baseUrl: rr.baseUrl.trim().replace(/\/$/, ""),
        model: rr.model.trim(),
        ...(typeof rr.apiKey === "string" && { apiKey: rr.apiKey }),
        ...(typeof rr.taskInstruction === "string" && {
          taskInstruction: rr.taskInstruction,
        }),
        ...(typeof rr.maxCandidates === "number" && {
          maxCandidates: rr.maxCandidates,
        }),
        ...(typeof rr.topK === "number" && { topK: rr.topK }),
      };
    }
  }

  return { embedding, reranker };
}

// ── Embedding client ──────────────────────────────────────────────────────────

/**
 * Embed a single text using the /v1/embeddings endpoint.
 * Documents: pass text directly (no instruction prefix).
 * Queries:   use embedQuery() which applies the task instruction.
 */
export async function embedTexts(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const url = `${config.baseUrl}/embeddings`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey ?? "none"}`,
  };
  const body = {
    model: config.model,
    input: texts,
    ...(config.dimensions ? { dimensions: config.dimensions } : {}),
  };
  const requestId = createUsageLogRequestId();
  const startedAt = Date.now();
  writeLlmUsageLog({
    ts: new Date().toISOString(),
    status: "started",
    subsystem: "embedding",
    model: config.model,
    baseUrl: config.baseUrl,
    endpoint: "/embeddings",
    requestId,
    request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const responseText = await res.text();
    let responseJson: unknown = responseText;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      // keep raw text
    }
    if (!res.ok) {
      writeLlmUsageLog({
        ts: new Date().toISOString(),
        status: "failed",
        subsystem: "embedding",
        model: config.model,
        baseUrl: config.baseUrl,
        endpoint: "/embeddings",
        requestId,
        request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
        response: { status: res.status, statusText: res.statusText, body: responseJson },
        error: `HTTP ${res.status} ${res.statusText}`,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
    writeLlmUsageLog({
      ts: new Date().toISOString(),
      status: "completed",
      subsystem: "embedding",
      model: config.model,
      baseUrl: config.baseUrl,
      endpoint: "/embeddings",
      requestId,
      request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
      response: { status: res.status, statusText: res.statusText, body: responseJson },
      durationMs: Date.now() - startedAt,
    });
    const json = responseJson as {
      data?: Array<{ embedding: number[] }>;
    };
    if (!json.data || json.data.length !== texts.length) return null;
    return json.data.map((d) => d.embedding);
  } catch (err) {
    writeLlmUsageLog({
      ts: new Date().toISOString(),
      status: "failed",
      subsystem: "embedding",
      model: config.model,
      baseUrl: config.baseUrl,
      endpoint: "/embeddings",
      requestId,
      request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}

/**
 * Embed a query, prepending the task instruction if configured.
 * Qwen3-Embedding: queries need "Instruct: {task}\nQuery:{query}", docs don't.
 */
export async function embedQuery(
  config: EmbeddingConfig,
  query: string,
): Promise<number[] | null> {
  const instruction = config.taskInstruction;
  const text = instruction
    ? `Instruct: ${instruction}\nQuery:${query}`
    : query;
  const results = await embedTexts(config, [text]);
  return results?.[0] ?? null;
}

/**
 * Embed a document (summary content). No instruction prefix for documents.
 */
export async function embedDocument(
  config: EmbeddingConfig,
  text: string,
): Promise<number[] | null> {
  const results = await embedTexts(config, [text]);
  return results?.[0] ?? null;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Deserialize a BLOB-stored Float32 embedding back to number[]. */
export function deserializeEmbedding(blob: Buffer | Uint8Array): number[] {
  const buf =
    blob instanceof Buffer ? blob : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const floats = new Float32Array(
    buf.buffer,
    buf.byteOffset,
    buf.byteLength / 4,
  );
  return Array.from(floats);
}

/** Serialize a number[] embedding to a Float32 Buffer for SQLite BLOB storage. */
export function serializeEmbedding(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer);
}

// ── Reranker client ───────────────────────────────────────────────────────────

export interface RankedCandidate {
  summaryId: string;
  content: string;
  score: number;
}

/**
 * Rerank candidates using the /v1/rerank endpoint (native oMLX / Jina-style API).
 * Falls back to returning candidates in vector-score order if the call fails.
 */
export async function rerankCandidates(
  config: RerankerConfig,
  query: string,
  candidates: Array<{ summaryId: string; content: string; vectorScore: number }>,
): Promise<RankedCandidate[]> {
  const topK = config.topK ?? 8;
  const documents = candidates.map((c) => c.content.slice(0, 2000));
  const url = `${config.baseUrl}/rerank`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey ?? "none"}`,
  };
  const body = {
    model: config.model,
    query,
    documents,
    top_n: topK,
    ...(config.taskInstruction ? { instruction: config.taskInstruction } : {}),
  };
  const requestId = createUsageLogRequestId();
  const startedAt = Date.now();
  writeLlmUsageLog({
    ts: new Date().toISOString(),
    status: "started",
    subsystem: "reranker",
    model: config.model,
    baseUrl: config.baseUrl,
    endpoint: "/rerank",
    requestId,
    request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const responseText = await res.text();
    let responseJson: unknown = responseText;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      // keep raw text
    }

    if (!res.ok) {
      writeLlmUsageLog({
        ts: new Date().toISOString(),
        status: "failed",
        subsystem: "reranker",
        model: config.model,
        baseUrl: config.baseUrl,
        endpoint: "/rerank",
        requestId,
        request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
        response: { status: res.status, statusText: res.statusText, body: responseJson },
        error: `HTTP ${res.status} ${res.statusText}`,
        durationMs: Date.now() - startedAt,
      });
      // Fall back to vector order
      return candidates
        .sort((a, b) => b.vectorScore - a.vectorScore)
        .slice(0, topK)
        .map((c) => ({ summaryId: c.summaryId, content: c.content, score: c.vectorScore }));
    }
    writeLlmUsageLog({
      ts: new Date().toISOString(),
      status: "completed",
      subsystem: "reranker",
      model: config.model,
      baseUrl: config.baseUrl,
      endpoint: "/rerank",
      requestId,
      request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
      response: { status: res.status, statusText: res.statusText, body: responseJson },
      durationMs: Date.now() - startedAt,
    });

    const json = responseJson as {
      results?: Array<{ index: number; relevance_score: number }>;
    };

    if (!json.results || json.results.length === 0) {
      return candidates
        .sort((a, b) => b.vectorScore - a.vectorScore)
        .slice(0, topK)
        .map((c) => ({ summaryId: c.summaryId, content: c.content, score: c.vectorScore }));
    }

    return json.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, topK)
      .map((r) => ({
        summaryId: candidates[r.index].summaryId,
        content: candidates[r.index].content,
        score: r.relevance_score,
      }));
  } catch (err) {
    writeLlmUsageLog({
      ts: new Date().toISOString(),
      status: "failed",
      subsystem: "reranker",
      model: config.model,
      baseUrl: config.baseUrl,
      endpoint: "/rerank",
      requestId,
      request: buildHttpUsageRequest({ url, method: "POST", headers, body }),
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return candidates
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, topK)
      .map((c) => ({ summaryId: c.summaryId, content: c.content, score: c.vectorScore }));
  }
}

// ── Main search orchestrator ──────────────────────────────────────────────────

export interface SemanticSearchInput {
  query: string;
  /** Pre-fetched candidate pool from FTS5 or full scan */
  candidates: Array<{ summaryId: string; content: string; embedding?: Buffer | null }>;
  config: SemanticSearchConfig;
  /** Max candidates to pass to reranker (overrides config) */
  maxCandidates?: number;
  /** Max results to return (overrides config.reranker.topK) */
  topK?: number;
}

export interface SemanticSearchResult {
  summaryId: string;
  content: string;
  score: number;
  method: "vector+rerank" | "vector" | "fallback";
}

/**
 * Full semantic search pipeline: embed query → cosine sim → optional rerank.
 *
 * Returns results sorted by relevance score descending.
 * Falls back gracefully at each stage if a model call fails.
 */
export async function semanticSearch(
  input: SemanticSearchInput,
): Promise<SemanticSearchResult[]> {
  const { query, candidates, config } = input;
  const maxCandidates = input.maxCandidates ?? config.reranker?.maxCandidates ?? 30;
  const topK = input.topK ?? config.reranker?.topK ?? 8;

  if (candidates.length === 0) return [];

  // Step 1: embed query
  const queryVec = await embedQuery(config.embedding, query);
  if (!queryVec) {
    // Embedding failed — return unscored candidates (caller will fall back to FTS5 order)
    return candidates.slice(0, topK).map((c) => ({
      summaryId: c.summaryId,
      content: c.content,
      score: 0,
      method: "fallback",
    }));
  }

  // Step 2: score each candidate by cosine similarity
  const scored = candidates
    .map((c) => {
      const vec = c.embedding ? deserializeEmbedding(c.embedding) : null;
      const vectorScore = vec ? cosineSimilarity(queryVec, vec) : 0;
      return { summaryId: c.summaryId, content: c.content, vectorScore };
    })
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, maxCandidates);

  // Step 3: rerank (optional)
  if (!config.reranker) {
    return scored.slice(0, topK).map((c) => ({
      summaryId: c.summaryId,
      content: c.content,
      score: c.vectorScore,
      method: "vector",
    }));
  }

  const reranked = await rerankCandidates(config.reranker, query, scored);
  return reranked.map((c) => ({
    summaryId: c.summaryId,
    content: c.content,
    score: c.score,
    method: "vector+rerank",
  }));
}
