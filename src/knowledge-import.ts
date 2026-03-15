import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { SemanticSearchConfig } from "./semantic-search.js";
import { embedTexts, serializeEmbedding } from "./semantic-search.js";
import type { KnowledgeMountMode, KnowledgeStore } from "./store/knowledge-store.js";

export type ImportKnowledgeFileInput = {
  packId: string;
  filePath: string;
  title?: string;
  description?: string;
  domain?: string;
  version?: string;
  chunkTargetTokens?: number;
  chunkOverlapTokens?: number;
  agentId?: string;
  mount?: boolean;
  mountMode?: KnowledgeMountMode;
  searchConfig?: SemanticSearchConfig | null;
};

export type ImportedKnowledgeFileResult = {
  packId: string;
  documentId: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  mountedToAgent: string | null;
};

type ChunkDraft = {
  heading?: string;
  sectionPath?: string;
  content: string;
  tokenCount: number;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00A0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractTextFromHtml(raw: string): string {
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(stripped));
}

function extractTextWithTextutil(filePath: string): string {
  const output = execFileSync(
    "/usr/bin/textutil",
    ["-convert", "txt", "-stdout", filePath],
    { encoding: "utf8" },
  );
  const text = normalizeWhitespace(output);
  if (!text) {
    throw new Error(`textutil returned no extractable text for ${filePath}`);
  }
  return text;
}

function extractTextWithMdls(filePath: string): string {
  const output = execFileSync(
    "/usr/bin/mdls",
    ["-raw", "-name", "kMDItemTextContent", filePath],
    { encoding: "utf8" },
  ).trim();
  if (!output || output === "(null)") {
    throw new Error(`mdls returned no extractable text for ${filePath}`);
  }
  return normalizeWhitespace(output);
}

function readSourceText(filePath: string): { text: string; mimeType: string } {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".txt" || ext === ".md" || ext === ".markdown" || ext === ".json") {
    return {
      text: normalizeWhitespace(readFileSync(filePath, "utf8")),
      mimeType: ext === ".json" ? "application/json" : "text/plain",
    };
  }
  if (ext === ".html" || ext === ".htm") {
    return {
      text: extractTextFromHtml(readFileSync(filePath, "utf8")),
      mimeType: "text/html",
    };
  }
  if (ext === ".docx" || ext === ".doc" || ext === ".rtf" || ext === ".rtfd") {
    return {
      text: extractTextWithTextutil(filePath),
      mimeType:
        ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === ".doc"
            ? "application/msword"
            : "text/rtf",
    };
  }
  if (ext === ".pdf") {
    return {
      text: extractTextWithMdls(filePath),
      mimeType: "application/pdf",
    };
  }
  throw new Error(
    `Unsupported import type for ${filePath}. Current importer supports .txt, .md, .json, .html, .htm, .docx, .doc, .rtf, .rtfd, and .pdf.`,
  );
}

function classifyHeading(line: string): { level: number; text: string } | null {
  const markdown = line.match(/^(#{1,6})\s+(.+)$/);
  if (markdown) {
    return { level: markdown[1].length, text: markdown[2].trim() };
  }
  const numbered = line.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  if (numbered && line.length <= 120) {
    return { level: Math.min(6, numbered[1].split(".").length), text: line.trim() };
  }
  return null;
}

function chunkText(params: {
  text: string;
  targetTokens: number;
  overlapTokens: number;
}): ChunkDraft[] {
  const blocks = params.text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const chunks: ChunkDraft[] = [];
  let headingStack: string[] = [];
  let currentParagraphs: string[] = [];
  let currentTokens = 0;
  let currentHeading: string | undefined;

  const flush = () => {
    if (currentParagraphs.length === 0) return;
    const content = currentParagraphs.join("\n\n").trim();
    if (!content) return;
    chunks.push({
      heading: currentHeading,
      sectionPath: headingStack.length > 0 ? headingStack.join(" > ") : undefined,
      content,
      tokenCount: estimateTokens(content),
    });

    if (params.overlapTokens <= 0) {
      currentParagraphs = [];
      currentTokens = 0;
      return;
    }

    const overlap: string[] = [];
    let overlapTokens = 0;
    for (let i = currentParagraphs.length - 1; i >= 0; i--) {
      const para = currentParagraphs[i];
      const tokens = estimateTokens(para);
      if (overlap.length > 0 && overlapTokens + tokens > params.overlapTokens) {
        break;
      }
      overlap.unshift(para);
      overlapTokens += tokens;
    }
    currentParagraphs = overlap;
    currentTokens = overlapTokens;
  };

  for (const block of blocks) {
    const heading = classifyHeading(block);
    if (heading) {
      flush();
      headingStack = headingStack.slice(0, Math.max(0, heading.level - 1));
      headingStack[heading.level - 1] = heading.text;
      currentHeading = heading.text;
      continue;
    }

    const blockTokens = estimateTokens(block);
    if (currentTokens > 0 && currentTokens + blockTokens > params.targetTokens) {
      flush();
    }
    currentParagraphs.push(block);
    currentTokens += blockTokens;
  }

  flush();
  return chunks;
}

export async function importKnowledgeFile(input: {
  store: KnowledgeStore;
  params: ImportKnowledgeFileInput;
}): Promise<ImportedKnowledgeFileResult> {
  const targetTokens = Math.max(200, Math.trunc(input.params.chunkTargetTokens ?? 1200));
  const overlapTokens = Math.max(0, Math.trunc(input.params.chunkOverlapTokens ?? 150));
  const { text, mimeType } = readSourceText(input.params.filePath);
  const title = input.params.title?.trim() || basename(input.params.filePath);
  const contentHash = createHash("sha256").update(text).digest("hex");
  const documentId = `doc_${randomUUID()}`;
  const createdAt = new Date();

  input.store.upsertPack({
    packId: input.params.packId,
    name: input.params.packId,
    description: input.params.description,
    domain: input.params.domain,
    version: input.params.version,
    createdAt,
    updatedAt: createdAt,
  });

  input.store.insertDocument({
    documentId,
    packId: input.params.packId,
    title,
    sourcePath: input.params.filePath,
    mimeType,
    byteSize: Buffer.byteLength(text, "utf8"),
    contentHash,
    metadataJson: JSON.stringify({ importedFrom: input.params.filePath }),
    createdAt,
  });

  const chunkDrafts = chunkText({
    text,
    targetTokens,
    overlapTokens,
  });

  const chunkIds: string[] = [];
  for (let i = 0; i < chunkDrafts.length; i++) {
    const draft = chunkDrafts[i];
    const chunkId = `chunk_${randomUUID()}`;
    chunkIds.push(chunkId);
    input.store.insertChunk({
      chunkId,
      packId: input.params.packId,
      documentId,
      ordinal: i,
      heading: draft.heading,
      sectionPath: draft.sectionPath,
      content: draft.content,
      tokenCount: draft.tokenCount,
      metadataJson: JSON.stringify({ title }),
      createdAt,
    });
  }

  let embeddedChunkCount = 0;
  const embeddingConfig = input.params.searchConfig?.embedding ?? null;
  if (embeddingConfig && chunkDrafts.length > 0) {
    const embeddings = await embedTexts(
      embeddingConfig,
      chunkDrafts.map((draft) => draft.content),
    );
    if (embeddings && embeddings.length === chunkDrafts.length) {
      for (let i = 0; i < embeddings.length; i++) {
        input.store.storeChunkEmbedding(
          chunkIds[i],
          embeddingConfig.model,
          embeddings[i].length,
          serializeEmbedding(embeddings[i]),
        );
      }
      embeddedChunkCount = embeddings.length;
    }
  }

  let mountedToAgent: string | null = null;
  if (input.params.mount !== false && input.params.agentId) {
    input.store.mountPack({
      agentId: input.params.agentId,
      packId: input.params.packId,
      mode: input.params.mountMode ?? "on_demand",
    });
    mountedToAgent = input.params.agentId;
  }

  return {
    packId: input.params.packId,
    documentId,
    title,
    chunkCount: chunkDrafts.length,
    embeddedChunkCount,
    mountedToAgent,
  };
}
