<p align="center">
  <strong>lossless-claw</strong><br>
  <em>A context operating system for AI agents</em>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#knowledge-packs">Knowledge Packs</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#architecture">Architecture</a>
</p>

---

## What is lossless-claw?

**lossless-claw** is a context management plugin for [OpenClaw](https://github.com/AgenticFoundation/openclaw) that makes AI agents dramatically sharper over long sessions. It solves the core problem of running persistent, tool-heavy agents: as conversations grow, models drown in their own context — they forget what happened, hallucinate stale data, choke on huge tool outputs, and eventually need a hard reset.

lossless-claw fixes that. It stores everything, retrieves only what matters, and keeps the active prompt lean enough for coherent reasoning — even on smaller, locally-run models.

### The result

- **No more `/new`.** Sessions stay productive for hundreds of turns.
- **Tool outputs stop poisoning context.** Giant file reads, shell dumps, and API responses are intelligently compacted.
- **Agents remember what's true *right now*.** Session-state working memory replaces archaelogy through old summaries.
- **Installed knowledge, not conversational reading.** Mount textbooks, manuals, and reference docs as queryable knowledge packs — the agent searches on demand instead of fake-reading 600 pages in chat.
- **Observe everything.** Full forensic logging of summarization, embedding, reranking, and model routing decisions.

---

## Quick Start

### Installation

```bash
npm install @martian-engineering/lossless-claw
```

### Register with OpenClaw

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "lossless-claw": {
        "enabled": true,
        "config": {
          "contextThreshold": 0.40,
          "freshTailCount": 8,
          "toolResultCap": 400,
          "summaryMode": "auto"
        }
      }
    }
  }
}
```

That's it. Every agent gets intelligent context management out of the box — no per-agent tuning required.

---

## Features

lossless-claw's features are organized into three tiers of increasing specificity:

| Tier | What it does | Configuration needed |
|------|-------------|---------------------|
| **Tier 1 — Engine** | Core context mechanics: pressure loops, provenance tracking, stale-data eviction | Numbers only |
| **Tier 2 — Heuristics** | Smart defaults: ack pruning, tool-result capping, reasoning trace handling, summary modes | Toggles |
| **Tier 3 — Agent Policies** | Domain-aware optimization: session state, tool compaction rules, freshness TTL | Per-agent `context-policy.json` |

### Context-Pressure Relief

Before the model sees a single token, lossless-claw estimates whether the conversation is under memory pressure and runs compaction passes *before* assembly — not after. This prevents the "context overflow" crashes that plague long sessions.

When the fresh tail alone exceeds budget, the oldest messages are trimmed (not dropped — they remain in the DAG and are available via recall tools). The system never silently loses information.

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `pressureLoop` | boolean | `true` | Pre-assembly pressure estimation and compaction |
| `pressureMaxPasses` | integer | `3` | Maximum compaction passes before assembly |
| `freshTailTrimUnderPressure` | boolean | `true` | Trim oldest fresh-tail messages instead of overflowing |

### Tool-Output Hygiene

Tool outputs are where agents die. A giant shell log, an oversized file read, or a bloated web scrape can eat the entire prompt and wreck downstream reasoning. lossless-claw applies layered defenses:

- **Deterministic size capping** — individual tool results are truncated beyond a configurable token limit, with a marker pointing to the full content via recall tools.
- **Rule-based field extraction** — instead of blind truncation, extract only the fields the agent actually needs (e.g., from a spreadsheet read, keep only `day`, `start`, `end`, `total`).
- **Provenance-aware classification** — every tool result is tagged as `observed` (a read), `computed` (a calculation), or `mutation` (a write). This metadata drives smarter eviction and summarization.

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `toolResultCap` | integer | `400` | Max tokens per tool result. `0` = unlimited. |
| `provenanceTyping` | boolean | `true` | Classify tool results by provenance kind |
| `provenanceEviction` | boolean | `true` | Evict stale reads after a write to the same resource |

### Session-State Working Memory

After 50+ turns, a model has no concise picture of where things stand *right now*. Summaries tell it what happened; the session-state document tells it what's *true*. It's a compact, structured snapshot — current task, active files, last error, pending follow-up — that the model can use far more effectively than a slurry of compressed history.

```
[Session State]
Active project: billing-module refactor
Current file: src/invoices/processor.ts
Last operation: added retry logic to processPayment()
Open questions: whether to backfill existing failed records
Next step: write integration tests for the retry path

[Recent Activity]  — lcm_grep("<timestamp or keyword>") for full context
3:45 PM — Added retry logic to processPayment() with exponential backoff
3:30 PM — Identified flaky payment failures in production logs
3:15 PM — Read processor.ts (420 lines, 3 payment methods)
```

The session-state document is maintained by a dedicated background model call (fire-and-forget after tool-using turns) and injected into the prompt before summaries and messages. Token budget is reserved automatically.

**Schema is fully customizable** per agent — you define the fields that matter for your domain. The system generates structured JSON updates and merges them field-by-field (unchanged fields are preserved, not overwritten).

### Summary Intelligence

| Mode | Behavior | Best for |
|------|----------|----------|
| `always` | Summaries always included in context | Long refactors, narrative continuity |
| `on-demand` | Summaries excluded; agent uses recall tools when needed | Repetitive operations, structured workflows |
| `auto` *(default)* | Included under 50% utilization, excluded under pressure | General-purpose agents |

Per-agent `summaryInstructions` let you steer what the summarizer preserves — file changes and stack traces for coding agents, calendar commitments for assistant agents, spreadsheet anomalies for data agents.

### Acknowledgment Pruning

Low-value conversational exchanges ("ok thanks" / "You're welcome!") are detected and removed from the assembled context. Messages containing tool calls, task intent, or substantial content are never pruned. All pruned messages remain in the DAG.

### Reasoning Trace Handling

Previous-turn thinking blocks consume tokens but rarely help the current turn. lossless-claw drops them by default (they're preserved in the DAG). Modes: `keep`, `drop` *(default)*.

### Busy-Aware Multi-Model Routing

lossless-claw expects heterogeneous local infrastructure. Session-state updates, compaction, and main inference can each target different models with independent fallback chains:

| Config | Description |
|--------|-------------|
| `sessionState.provider` / `sessionState.model` | Dedicated model for session-state updates |
| `sessionState.fallbackOnBusy` | Fall back to alternate model when primary is occupied |
| `sessionState.fallbackOnFailure` | Fall back on hard failures (use sparingly) |
| `sessionState.timeoutMs` | Per-call timeout for session-state model |

This matters on local hardware where a single GPU can be healthy but simply occupied by another task.

---

## Knowledge Packs

Knowledge Packs are the imported-knowledge layer. Instead of forcing an agent to "read" a 600-page manual in chat, you import it offline, and the system installs a structured, queryable retrieval substrate the agent can consult instantly.

### How it works

1. **Import** a document offline via the admin CLI.
2. **lossless-claw** extracts text, chunks it by structure (respecting section boundaries), and optionally embeds each chunk.
3. **Mount** the pack to one or more agents.
4. The agent **discovers** mounted packs at runtime and **searches** them on demand — only the relevant chunks enter the prompt, never the whole corpus.

### Supported formats

`txt` · `md` · `json` · `html` · `htm` · `docx` · `doc` · `rtf` · `rtfd` · `pdf`

### Admin CLI

```bash
# Import a document into a pack
npm run knowledge:admin -- import --agent myagent --pack-id python-reference --file /path/to/document.pdf

# Mount a pack to an agent
npm run knowledge:admin -- mount --agent myagent --pack-id python-reference

# List mounted packs
npm run knowledge:admin -- list --agent myagent

# Audit pack integrity (detect duplicates, partial embeddings)
npm run knowledge:admin -- audit --pack-id python-reference

# Repair issues found by audit
npm run knowledge:admin -- repair --agent myagent --pack-id python-reference

# Unmount a pack
npm run knowledge:admin -- unmount --agent myagent --pack-id python-reference
```

### Agent-facing tools

| Tool | Description |
|------|-------------|
| `lcm_knowledge_list` | Discover mounted packs and their descriptions |
| `lcm_knowledge_search` | Search across mounted packs by query |

Agents can search but **cannot** import, mount, or unmount packs. That control stays with the operator.

### Three memory classes

lossless-claw treats memory as three distinct classes, each with its own storage, retrieval semantics, and lifecycle:

| Class | What it stores | Retrieval | Eviction |
|-------|---------------|-----------|----------|
| **Experiential** | Messages, tool results, summaries, decisions | Chronological + recall tools | Freshness TTL, provenance eviction |
| **Imported knowledge** | Textbooks, manuals, SOPs, reference docs | Semantic search (embeddings + reranker) | Never auto-evicted |
| **Session state** | Current task, active files, pending follow-up | Always injected into prompt | Overwritten on update |

This separation is a core design decision. Imported knowledge is never confused with lived experience, and neither pollutes the other's retrieval.

---

## Agent Recall Tools

lossless-claw provides agents with tools to search and retrieve from their own conversation history:

| Tool | Description |
|------|-------------|
| `lcm_grep` | Full-text search across the conversation DAG (BM25 via FTS5) |
| `lcm_describe` | Summarize a specific DAG node or time range |
| `lcm_expand_query` | Retrieve detailed context around a search result or topic |

These tools are how agents access information that's been compacted out of the active context. Nothing is ever deleted — it's just moved out of the prompt and made retrievable.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     OpenClaw                        │
│                  (Agent Runtime)                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                  lossless-claw                      │
│              (Context Management Plugin)            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Assembler │  │ Engine   │  │ Knowledge Packs   │ │
│  │          │  │          │  │                   │ │
│  │ •Pressure│  │ •Compac- │  │ •Import pipeline  │ │
│  │  loop    │  │  tion    │  │ •Chunking         │ │
│  │ •Prove-  │  │ •Session │  │ •Embeddings       │ │
│  │  nance   │  │  state   │  │ •Retrieval        │ │
│  │ •Eviction│  │ •Routing │  │ •Agent mounts     │ │
│  │ •Pruning │  │ •Manifests│ │                   │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │              SQLite (lcm.db)                 │   │
│  │  DAG · Summaries · Session State · Knowledge │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Core flow

1. **Store broadly.** Every message, tool result, and summary is persisted in a DAG-structured SQLite database.
2. **Compress incrementally.** The DAG-based summarization engine compacts history through leaf and consolidated summary passes.
3. **Retrieve narrowly.** At assembly time, only the relevant summaries, recent messages, session state, and retrieved knowledge make it into the prompt.
4. **Keep the prompt lean.** Pre-assembly pressure loops, provenance eviction, acknowledgment pruning, tool-result capping, and reasoning trace dropping all work together to keep context small enough for clear model reasoning.

### What lossless-claw extends (not replaces)

The upstream OpenClaw plugin API provides message persistence, summary graph construction, and basic recall. lossless-claw adds the entire operational layer on top: pressure management, provenance tracking, session state, knowledge packs, multi-model routing, context manifests, and deep configurability.

---

## Configuration

### Global Configuration

All settings live under `plugins.entries.lossless-claw.config` in your `openclaw.json`. These are the defaults for all agents.

```json
{
  "plugins": {
    "entries": {
      "lossless-claw": {
        "config": {
          "pressureLoop": true,
          "pressureMaxPasses": 3,
          "contextThreshold": 0.40,
          "freshTailCount": 8,
          "freshTailTrimUnderPressure": true,
          "provenanceTyping": true,
          "provenanceEviction": true,
          "ackPruning": false,
          "ackPruningMaxTokens": 30,
          "summaryMode": "auto",
          "toolResultCap": 400,
          "reasoningTraceMode": "drop"
        }
      }
    }
  }
}
```

### Per-Agent Policies

Per-agent overrides and Tier 3 features are defined in a `context-policy.json` file in the agent's workspace directory.

```json
{
  "summaryInstructions": "Preserve file paths, function names, stack traces, and design decisions.",

  "overrides": {
    "summaryMode": "always",
    "toolResultCap": 300,
    "ackPruning": true
  },

  "memory": {
    "enabled": true,
    "injectHint": true
  },

  "knowledge": {
    "enabled": true,
    "injectPackList": true,
    "maxInjectedPacks": 5,
    "exampleQuery": "how does the retry logic work?"
  },

  "sessionState": {
    "enabled": true,
    "maxTokens": 300,
    "format": "hybrid",
    "updateOn": "mutation",
    "schema": {
      "fields": [
        {"name": "currentFile", "label": "Current file"},
        {"name": "lastOperation", "label": "Last operation"},
        {"name": "openQuestions", "label": "Open questions"}
      ]
    },
    "activityLog": {
      "enabled": true,
      "maxEntries": 10,
      "recallHint": true
    },
    "provider": "my-local-provider",
    "model": "small-model-4b",
    "thinkingEnabled": true,
    "timeoutMs": 30000,
    "fallbackOnBusy": true,
    "routingEnabled": true
  },

  "toolResultCompaction": {
    "rules": [
      {
        "toolNamePattern": "read_file",
        "extractFields": ["content", "path"],
        "maxTokens": 200
      }
    ]
  },

  "toolClassification": {
    "observed": ["read_file", "list_dir", "get_status"],
    "computed": ["calculate", "aggregate"],
    "mutation": ["write_file", "execute_command", "deploy"]
  },

  "freshnessTtl": {
    "default": 300,
    "byTool": {
      "get_status": 30,
      "read_file": 600
    }
  }
}
```

### Config Precedence

Settings resolve in this order (highest precedence first):

1. Environment variables (`LCM_*`)
2. Per-agent `context-policy.json` overrides
3. Plugin config in `openclaw.json`
4. Hardcoded defaults

### Runtime Capability Injection

lossless-claw can inject runtime hints into the system prompt so the agent knows it has memory and knowledge tools available:

- **Memory hints** — a compact reminder that recall tools (`lcm_grep`, `lcm_describe`, `lcm_expand_query`) exist and when to use them.
- **Knowledge hints** — a short list of mounted packs and an example search query, so the agent knows what expertise is installed.

This keeps capability awareness dynamic rather than buried in static workspace instructions.

---

## Context Manifests

On every assembly, lossless-claw writes a manifest file recording exactly what went into the model prompt. This is a forensic and debugging tool.

```json
{
  "version": 1,
  "manifestId": "<hash>",
  "sessionId": "<uuid>",
  "assembledAt": "<iso8601>",
  "tokenBudget": 65536,
  "estimatedTokens": 8200,
  "ozempicFeatures": {
    "pressureLoop": true,
    "provenanceTyping": true,
    "summaryMode": "on-demand",
    "toolResultCap": 200
  },
  "stats": {
    "totalResolvedItems": 24,
    "selectedItems": 12,
    "prunedAcknowledgments": 2,
    "truncatedToolResults": 1,
    "droppedReasoningTraces": 4,
    "evictedStaleObserved": 1
  }
}
```

Manifests are written to `~/.openclaw/aeon/manifests/<sessionId>.latest.json`. Only the latest manifest per session is kept on disk.

---

## Observability

lossless-claw writes append-only JSONL logs for all LLM-adjacent operations:

- Summarization calls
- Session-state update calls
- Embedding calls
- Reranker calls

Logs are written to `~/.openclaw/usage-logs/lcm-llm-usage.jsonl`.

Combined with OpenClaw's session transcripts, you can answer:

- What did the agent actually do on a given turn?
- What model did lossless-claw call, and what was the raw request?
- Did the call complete, fail, or time out?
- Did the agent use memory, knowledge, or just freestyle?

---

## Design Principles

1. **Every feature is independently toggleable.** No feature requires another to function. Disabling provenance typing means provenance eviction silently becomes a no-op, not an error.

2. **Sensible defaults work for every agent.** A new agent gets Tier 1 + Tier 2 defaults with zero configuration. Defaults are conservative — they never make things worse.

3. **The DAG is the source of truth.** lossless-claw only controls what the model sees on a given turn. It never deletes data. Everything it prunes, trims, or evicts from context remains available via recall tools.

4. **Fail-open, not fail-closed.** Uncertain provenance? Keep the item. Ambiguous eviction target? Keep the stale item. JSON parse failure in compaction? Fall back to truncation. The system should never lose information the model needs.

5. **The summary model is cheap — use it.** Session-state updates and compaction pass through a local summary model with zero API cost. Don't ration it.

6. **Manifests are forensic, not operational.** The model never sees manifests. They exist for debugging, tuning, and future guardrail integration.

---

## Project Structure

```
lossless-claw/
├── index.ts                  # Plugin entry point
├── openclaw.plugin.json      # Plugin manifest and config schema
├── src/
│   ├── assembler.ts          # Context assembly, pruning, eviction, capping
│   ├── compaction.ts         # DAG compaction and summarization engine
│   ├── context-manifest.ts   # Forensic manifest builder
│   ├── context-policy.ts     # Per-agent policy loader (Tier 3)
│   ├── engine.ts             # Core engine: lifecycle, routing, orchestration
│   ├── knowledge-import.ts   # Knowledge pack import pipeline
│   ├── knowledge-retrieval.ts# Knowledge pack search and retrieval
│   ├── retrieval.ts          # DAG recall engine (BM25/FTS5)
│   ├── semantic-search.ts    # Embedding-based semantic search
│   ├── session-state.ts      # Session-state document persistence
│   ├── integrity.ts          # DAG integrity checks and repair
│   ├── summarize.ts          # Summarization prompt construction
│   ├── db/                   # SQLite schema, migrations, config
│   ├── store/                # Data access layer
│   └── tools/                # Agent-facing tool implementations
│       ├── lcm-grep-tool.ts
│       ├── lcm-describe-tool.ts
│       ├── lcm-expand-query-tool.ts
│       ├── lcm-knowledge-list-tool.ts
│       └── lcm-knowledge-search-tool.ts
├── scripts/
│   └── knowledge-admin.ts    # Knowledge pack admin CLI
├── test/                     # Test suite (vitest)
├── docs/                     # Additional documentation
└── tui/                      # Terminal UI inspector
```

---

## License

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://github.com/Martian-Engineering">Martian Engineering</a></sub>
</p>
