import type { DatabaseSync } from "node:sqlite";

export type KnowledgeMountMode = "on_demand" | "auto_retrieve";

export type KnowledgePackRecord = {
  packId: string;
  name: string;
  description: string | null;
  domain: string | null;
  version: string | null;
  status: string;
  importConfigJson: string;
  artifactConfigJson: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateKnowledgePackInput = {
  packId: string;
  name: string;
  description?: string;
  domain?: string;
  version?: string;
  status?: string;
  importConfigJson?: string;
  artifactConfigJson?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type KnowledgeDocumentRecord = {
  documentId: string;
  packId: string;
  title: string | null;
  sourcePath: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  contentHash: string;
  metadataJson: string;
  createdAt: Date;
};

export type CreateKnowledgeDocumentInput = {
  documentId: string;
  packId: string;
  title?: string;
  sourcePath?: string;
  sourceUrl?: string;
  mimeType?: string;
  byteSize?: number;
  contentHash: string;
  metadataJson?: string;
  createdAt?: Date;
};

export type KnowledgeChunkRecord = {
  chunkId: string;
  packId: string;
  documentId: string;
  ordinal: number;
  heading: string | null;
  sectionPath: string | null;
  content: string;
  tokenCount: number;
  charCount: number;
  metadataJson: string;
  createdAt: Date;
};

export type CreateKnowledgeChunkInput = {
  chunkId: string;
  packId: string;
  documentId: string;
  ordinal: number;
  heading?: string;
  sectionPath?: string;
  content: string;
  tokenCount: number;
  charCount?: number;
  metadataJson?: string;
  createdAt?: Date;
};

export type KnowledgeChunkEmbeddingRecord = {
  chunkId: string;
  model: string;
  dimensions: number;
  embedding: Buffer;
  createdAt: Date;
};

export type KnowledgeChunkCandidateRecord = {
  chunkId: string;
  packId: string;
  documentId: string;
  content: string;
  embedding: Buffer | null;
};

export type AgentKnowledgeMountRecord = {
  agentId: string;
  packId: string;
  enabled: boolean;
  mode: KnowledgeMountMode;
  priority: number;
  primerText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

interface KnowledgePackRow {
  pack_id: string;
  name: string;
  description: string | null;
  domain: string | null;
  version: string | null;
  status: string;
  import_config_json: string;
  artifact_config_json: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeDocumentRow {
  document_id: string;
  pack_id: string;
  title: string | null;
  source_path: string | null;
  source_url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  content_hash: string;
  metadata_json: string;
  created_at: string;
}

interface KnowledgeChunkRow {
  chunk_id: string;
  pack_id: string;
  document_id: string;
  ordinal: number;
  heading: string | null;
  section_path: string | null;
  content: string;
  token_count: number;
  char_count: number;
  metadata_json: string;
  created_at: string;
}

interface KnowledgeChunkEmbeddingRow {
  chunk_id: string;
  model: string;
  dimensions: number;
  embedding: Buffer;
  created_at: string;
}

interface AgentKnowledgeMountRow {
  agent_id: string;
  pack_id: string;
  enabled: number;
  mode: KnowledgeMountMode;
  priority: number;
  primer_text: string | null;
  created_at: string;
  updated_at: string;
}

function toIso(value?: Date): string {
  return (value ?? new Date()).toISOString();
}

function toKnowledgePackRecord(row: KnowledgePackRow): KnowledgePackRecord {
  return {
    packId: row.pack_id,
    name: row.name,
    description: row.description,
    domain: row.domain,
    version: row.version,
    status: row.status,
    importConfigJson: row.import_config_json,
    artifactConfigJson: row.artifact_config_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toKnowledgeDocumentRecord(row: KnowledgeDocumentRow): KnowledgeDocumentRecord {
  return {
    documentId: row.document_id,
    packId: row.pack_id,
    title: row.title,
    sourcePath: row.source_path,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    metadataJson: row.metadata_json,
    createdAt: new Date(row.created_at),
  };
}

function toKnowledgeChunkRecord(row: KnowledgeChunkRow): KnowledgeChunkRecord {
  return {
    chunkId: row.chunk_id,
    packId: row.pack_id,
    documentId: row.document_id,
    ordinal: row.ordinal,
    heading: row.heading,
    sectionPath: row.section_path,
    content: row.content,
    tokenCount: row.token_count,
    charCount: row.char_count,
    metadataJson: row.metadata_json,
    createdAt: new Date(row.created_at),
  };
}

function toKnowledgeChunkEmbeddingRecord(
  row: KnowledgeChunkEmbeddingRow,
): KnowledgeChunkEmbeddingRecord {
  return {
    chunkId: row.chunk_id,
    model: row.model,
    dimensions: row.dimensions,
    embedding: row.embedding,
    createdAt: new Date(row.created_at),
  };
}

function toAgentKnowledgeMountRecord(row: AgentKnowledgeMountRow): AgentKnowledgeMountRecord {
  return {
    agentId: row.agent_id,
    packId: row.pack_id,
    enabled: row.enabled === 1,
    mode: row.mode,
    priority: row.priority,
    primerText: row.primer_text,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class KnowledgeStore {
  constructor(private readonly db: DatabaseSync) {}

  upsertPack(input: CreateKnowledgePackInput): void {
    const createdAt = toIso(input.createdAt);
    const updatedAt = toIso(input.updatedAt);
    this.db.prepare(`
      INSERT INTO knowledge_packs (
        pack_id, name, description, domain, version, status,
        import_config_json, artifact_config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pack_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        domain = excluded.domain,
        version = excluded.version,
        status = excluded.status,
        import_config_json = excluded.import_config_json,
        artifact_config_json = excluded.artifact_config_json,
        updated_at = excluded.updated_at
    `).run(
      input.packId,
      input.name,
      input.description ?? null,
      input.domain ?? null,
      input.version ?? null,
      input.status ?? "active",
      input.importConfigJson ?? "{}",
      input.artifactConfigJson ?? "{}",
      createdAt,
      updatedAt,
    );
  }

  getPack(packId: string): KnowledgePackRecord | null {
    const row = this.db.prepare(`
      SELECT pack_id, name, description, domain, version, status,
             import_config_json, artifact_config_json, created_at, updated_at
      FROM knowledge_packs
      WHERE pack_id = ?
    `).get(packId) as KnowledgePackRow | undefined;
    return row ? toKnowledgePackRecord(row) : null;
  }

  listPacks(): KnowledgePackRecord[] {
    const rows = this.db.prepare(`
      SELECT pack_id, name, description, domain, version, status,
             import_config_json, artifact_config_json, created_at, updated_at
      FROM knowledge_packs
      ORDER BY updated_at DESC, created_at DESC
    `).all() as KnowledgePackRow[];
    return rows.map(toKnowledgePackRecord);
  }

  insertDocument(input: CreateKnowledgeDocumentInput): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_documents (
        document_id, pack_id, title, source_path, source_url, mime_type,
        byte_size, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.documentId,
      input.packId,
      input.title ?? null,
      input.sourcePath ?? null,
      input.sourceUrl ?? null,
      input.mimeType ?? null,
      input.byteSize ?? null,
      input.contentHash,
      input.metadataJson ?? "{}",
      toIso(input.createdAt),
    );
  }

  listDocumentsForPack(packId: string): KnowledgeDocumentRecord[] {
    const rows = this.db.prepare(`
      SELECT document_id, pack_id, title, source_path, source_url, mime_type,
             byte_size, content_hash, metadata_json, created_at
      FROM knowledge_documents
      WHERE pack_id = ?
      ORDER BY created_at ASC, document_id ASC
    `).all(packId) as KnowledgeDocumentRow[];
    return rows.map(toKnowledgeDocumentRecord);
  }

  insertChunk(input: CreateKnowledgeChunkInput): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_chunks (
        chunk_id, pack_id, document_id, ordinal, heading, section_path,
        content, token_count, char_count, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.chunkId,
      input.packId,
      input.documentId,
      input.ordinal,
      input.heading ?? null,
      input.sectionPath ?? null,
      input.content,
      input.tokenCount,
      input.charCount ?? input.content.length,
      input.metadataJson ?? "{}",
      toIso(input.createdAt),
    );
  }

  listChunksForPack(packId: string, limit?: number): KnowledgeChunkRecord[] {
    const sql = `
      SELECT chunk_id, pack_id, document_id, ordinal, heading, section_path,
             content, token_count, char_count, metadata_json, created_at
      FROM knowledge_chunks
      WHERE pack_id = ?
      ORDER BY document_id ASC, ordinal ASC
      ${typeof limit === "number" && limit > 0 ? `LIMIT ${Math.floor(limit)}` : ""}
    `;
    const rows = this.db.prepare(sql).all(packId) as KnowledgeChunkRow[];
    return rows.map(toKnowledgeChunkRecord);
  }

  listChunksForPacks(packIds: string[]): KnowledgeChunkRecord[] {
    if (packIds.length === 0) return [];
    const inClause = packIds.map(quoteSqlString).join(", ");
    const rows = this.db.prepare(`
      SELECT chunk_id, pack_id, document_id, ordinal, heading, section_path,
             content, token_count, char_count, metadata_json, created_at
      FROM knowledge_chunks
      WHERE pack_id IN (${inClause})
      ORDER BY pack_id ASC, document_id ASC, ordinal ASC
    `).all() as KnowledgeChunkRow[];
    return rows.map(toKnowledgeChunkRecord);
  }

  storeChunkEmbedding(
    chunkId: string,
    model: string,
    dimensions: number,
    embedding: Buffer,
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_chunk_embeddings (
        chunk_id, model, dimensions, embedding, created_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
    `).run(chunkId, model, dimensions, embedding);
  }

  getChunkEmbedding(chunkId: string, model: string): KnowledgeChunkEmbeddingRecord | null {
    const row = this.db.prepare(`
      SELECT chunk_id, model, dimensions, embedding, created_at
      FROM knowledge_chunk_embeddings
      WHERE chunk_id = ? AND model = ?
    `).get(chunkId, model) as KnowledgeChunkEmbeddingRow | undefined;
    return row ? toKnowledgeChunkEmbeddingRecord(row) : null;
  }

  getChunkCandidatesForPacks(packIds: string[], model: string): KnowledgeChunkCandidateRecord[] {
    if (packIds.length === 0) return [];
    const inClause = packIds.map(quoteSqlString).join(", ");
    const rows = this.db.prepare(`
      SELECT c.chunk_id, c.pack_id, c.document_id, c.content, e.embedding
      FROM knowledge_chunks c
      LEFT JOIN knowledge_chunk_embeddings e
        ON e.chunk_id = c.chunk_id AND e.model = ?
      WHERE c.pack_id IN (${inClause})
      ORDER BY c.pack_id ASC, c.document_id ASC, c.ordinal ASC
    `).all(model) as Array<{
      chunk_id: string;
      pack_id: string;
      document_id: string;
      content: string;
      embedding: Buffer | null;
    }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      packId: row.pack_id,
      documentId: row.document_id,
      content: row.content,
      embedding: row.embedding,
    }));
  }

  mountPack(params: {
    agentId: string;
    packId: string;
    enabled?: boolean;
    mode?: KnowledgeMountMode;
    priority?: number;
    primerText?: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): void {
    const createdAt = toIso(params.createdAt);
    const updatedAt = toIso(params.updatedAt);
    this.db.prepare(`
      INSERT INTO agent_knowledge_mounts (
        agent_id, pack_id, enabled, mode, priority, primer_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, pack_id) DO UPDATE SET
        enabled = excluded.enabled,
        mode = excluded.mode,
        priority = excluded.priority,
        primer_text = excluded.primer_text,
        updated_at = excluded.updated_at
    `).run(
      params.agentId,
      params.packId,
      params.enabled === false ? 0 : 1,
      params.mode ?? "on_demand",
      params.priority ?? 0,
      params.primerText ?? null,
      createdAt,
      updatedAt,
    );
  }

  unmountPack(agentId: string, packId: string): void {
    this.db.prepare(`
      DELETE FROM agent_knowledge_mounts
      WHERE agent_id = ? AND pack_id = ?
    `).run(agentId, packId);
  }

  listMountedPacks(agentId: string, enabledOnly: boolean = true): AgentKnowledgeMountRecord[] {
    const rows = this.db.prepare(`
      SELECT agent_id, pack_id, enabled, mode, priority, primer_text, created_at, updated_at
      FROM agent_knowledge_mounts
      WHERE agent_id = ?
        ${enabledOnly ? "AND enabled = 1" : ""}
      ORDER BY priority DESC, updated_at DESC, created_at DESC
    `).all(agentId) as AgentKnowledgeMountRow[];
    return rows.map(toAgentKnowledgeMountRecord);
  }
}
