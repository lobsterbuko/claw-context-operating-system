import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContextPolicy } from "../src/context-policy.js";
import { resolveLcmConfig } from "../src/db/config.js";
import { closeLcmConnection, getLcmConnection } from "../src/db/connection.js";
import { getLcmDbFeatures } from "../src/db/features.js";
import { runLcmMigrations } from "../src/db/migration.js";
import { importKnowledgeFile } from "../src/knowledge-import.js";
import { KnowledgeStore } from "../src/store/knowledge-store.js";

type Command = "import" | "mount" | "unmount" | "list";

type ParsedArgs = {
  command: Command;
  flags: Map<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  if (commandRaw !== "import" && commandRaw !== "mount" && commandRaw !== "unmount" && commandRaw !== "list") {
    throw new Error(
      "Usage: knowledge-admin <import|mount|unmount|list> [--agent <id>] [--pack-id <id>] [--file <path>]",
    );
  }

  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    i += 1;
  }

  return { command: commandRaw, flags };
}

function readFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function readBoolFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return flags.get(key) === true;
}

function requireFlag(flags: Map<string, string | boolean>, key: string): string {
  const value = readFlag(flags, key);
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function normalizeAgentId(agentId: string | undefined): string {
  const raw = (agentId ?? "").trim().toLowerCase();
  if (!raw || raw === "buko") {
    return "main";
  }
  return raw;
}

function resolveRepoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveOpenClawRoot(flags: Map<string, string | boolean>): string {
  const explicit = readFlag(flags, "openclaw-root");
  if (explicit) {
    return resolve(explicit);
  }
  return dirname(resolveRepoRoot());
}

function readOpenClawPluginConfig(openclawRoot: string): Record<string, unknown> | undefined {
  const configPath = join(openclawRoot, "openclaw.json");
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const pluginConfig = parsed?.plugins?.entries?.["lossless-claw"]?.config;
    return pluginConfig && typeof pluginConfig === "object"
      ? pluginConfig as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function loadAgentSearchConfig(openclawRoot: string, agentId: string) {
  const policyPath = join(openclawRoot, `workspace-${agentId}`, "context-policy.json");
  return loadContextPolicy(policyPath)?.search ?? null;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const openclawRoot = resolveOpenClawRoot(flags);
  const pluginConfig = readOpenClawPluginConfig(openclawRoot);
  const lcmConfig = resolveLcmConfig(process.env, pluginConfig);
  const db = getLcmConnection(lcmConfig.databasePath);
  runLcmMigrations(db, getLcmDbFeatures(db));
  const store = new KnowledgeStore(db);

  try {
    if (command === "import") {
      const agentId = normalizeAgentId(requireFlag(flags, "agent"));
      const packId = requireFlag(flags, "pack-id");
      const filePath = resolve(requireFlag(flags, "file"));
      const targetTokensRaw = readFlag(flags, "chunk-target-tokens");
      const overlapTokensRaw = readFlag(flags, "chunk-overlap-tokens");
      const result = await importKnowledgeFile({
        store,
        params: {
          agentId,
          packId,
          filePath,
          title: readFlag(flags, "title"),
          description: readFlag(flags, "description"),
          domain: readFlag(flags, "domain"),
          version: readFlag(flags, "version"),
          chunkTargetTokens: targetTokensRaw ? Number(targetTokensRaw) : undefined,
          chunkOverlapTokens: overlapTokensRaw ? Number(overlapTokensRaw) : undefined,
          mount: !readBoolFlag(flags, "no-mount"),
          searchConfig: loadAgentSearchConfig(openclawRoot, agentId),
        },
      });
      printJson({ ok: true, agentId, ...result });
      return;
    }

    if (command === "mount") {
      const agentId = normalizeAgentId(requireFlag(flags, "agent"));
      const packId = requireFlag(flags, "pack-id");
      if (!store.getPack(packId)) {
        throw new Error(`Unknown pack '${packId}'`);
      }
      const priorityRaw = readFlag(flags, "priority");
      store.mountPack({
        agentId,
        packId,
        mode: readFlag(flags, "mode") === "auto_retrieve" ? "auto_retrieve" : "on_demand",
        priority: priorityRaw ? Number(priorityRaw) : 0,
        primerText: readFlag(flags, "primer-text"),
      });
      printJson({ ok: true, agentId, packId, mounted: true });
      return;
    }

    if (command === "unmount") {
      const agentId = normalizeAgentId(requireFlag(flags, "agent"));
      const packId = requireFlag(flags, "pack-id");
      store.unmountPack(agentId, packId);
      printJson({ ok: true, agentId, packId, mounted: false });
      return;
    }

    const agentId = normalizeAgentId(requireFlag(flags, "agent"));
    const mounts = store.listMountedPacks(agentId, true).map((mount) => {
      const pack = store.getPack(mount.packId);
      return {
        packId: mount.packId,
        name: pack?.name ?? mount.packId,
        description: pack?.description ?? null,
        domain: pack?.domain ?? null,
        version: pack?.version ?? null,
        mode: mount.mode,
        priority: mount.priority,
        primerText: mount.primerText,
        documentCount: store.listDocumentsForPack(mount.packId).length,
        chunkCount: store.listChunksForPack(mount.packId).length,
      };
    });
    printJson({ ok: true, agentId, mounts });
  } finally {
    closeLcmConnection(lcmConfig.databasePath);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
