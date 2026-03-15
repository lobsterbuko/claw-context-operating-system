import { Type } from "@sinclair/typebox";
import type { LcmContextEngine } from "../engine.js";
import type { LcmDependencies } from "../types.js";
import type { AnyAgentTool } from "./common.js";

const LcmKnowledgeListSchema = Type.Object({});

export function createLcmKnowledgeListTool(input: {
  deps: LcmDependencies;
  lcm: LcmContextEngine;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    name: "lcm_knowledge_list",
    label: "LCM Knowledge List",
    description:
      "List Knowledge Packs mounted to the current agent, including short descriptions and basic stats, so the agent can decide what to search.",
    parameters: LcmKnowledgeListSchema,
    async execute() {
      const parsed = input.deps.parseAgentSessionKey(input.sessionKey ?? "");
      const agentId = input.deps.normalizeAgentId(parsed?.agentId);
      const store = input.lcm.getKnowledgeStore();
      const mounts = store.listMountedPacks(agentId, true);

      const lines: string[] = [];
      lines.push("## Mounted Knowledge Packs");
      lines.push(`**Agent:** ${agentId}`);
      lines.push("");

      if (mounts.length === 0) {
        lines.push("No mounted packs.");
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { agentId, packs: [] },
        };
      }

      const packs = mounts.map((mount) => {
        const pack = store.getPack(mount.packId);
        const documents = store.listDocumentsForPack(mount.packId);
        const chunks = store.listChunksForPack(mount.packId);
        return {
          packId: mount.packId,
          name: pack?.name ?? mount.packId,
          domain: pack?.domain ?? null,
          description: pack?.description ?? null,
          priority: mount.priority,
          mode: mount.mode,
          primerText: mount.primerText,
          documentCount: documents.length,
          chunkCount: chunks.length,
          version: pack?.version ?? null,
        };
      });

      for (const pack of packs) {
        lines.push(`### ${pack.name}`);
        lines.push(`packId=${pack.packId}`);
        if (pack.domain) lines.push(`domain=${pack.domain}`);
        if (pack.version) lines.push(`version=${pack.version}`);
        lines.push(`documents=${pack.documentCount} chunks=${pack.chunkCount} mode=${pack.mode} priority=${pack.priority}`);
        if (pack.description) {
          lines.push(pack.description);
        } else {
          lines.push("(no description)");
        }
        if (pack.primerText) {
          lines.push(`primer: ${pack.primerText}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { agentId, packs },
      };
    },
  };
}
