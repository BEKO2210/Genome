# GENOME — Project Genome System

Turns a repository into a queryable project brain. Instead of an agent reading
files all over the repo, it gets one compiled, task-scoped **Context Capsule**
built from curated knowledge.

**Four pillars**

1. **Genome** — knowledge split into addressable *atoms* + a typed *synapse* graph.
2. **Context Compiler** — builds a minimal capsule per task via graph traversal
   (not blind keyword-RAG).
3. **Firewall** — a real Claude Code PreToolUse hook that hard-blocks forbidden
   reads.
4. **Reflex + Review** — agents propose new knowledge into an inbox; only a
   human accepts it into the genome. Full provenance, no drift.

Zero dependencies. Pure ESM. Node ≥ 18. Fully offline.

## Quickstart

```bash
node .genome/genome.mjs init                                  # one-time bootstrap
node .genome/genome.mjs lint                                  # validate the genome
node .genome/genome.mjs brief "Fix the dashboard auth bug" --budget 3500
# the agent now works from .context/current.capsule.md
node .genome/genome.mjs reflex                                # queue suggestions
node .genome/genome.mjs review                                # list pending
node .genome/genome.mjs review --accept prop.xxxxx.001        # ratify
```

## Commands

| Command | What it does |
|---|---|
| `init` | Bootstrap `genome/`, `.genome/`, `.context/`, `.claude/` (idempotent). |
| `lint` | Validate `atoms.jsonl` and `synapses.jsonl`; exit 1 on errors. |
| `intent "<task>"` | Classify a task → `{intent, area, risk, needed_types}`. |
| `brief "<task>" [--budget N] [--intent I] [--depth D]` | Compile `.context/current.capsule.md`. |
| `receipt --task "<t>" --used id1,id2 --files f1,f2` | Append a run receipt. |
| `reflex` | Convert `.genome/inbox.json` into pending proposals. |
| `review` / `--accept <id>` / `--reject <id>` | Human gate for new knowledge. |

## Why it works

- **Graph beats keyword search.** The compiler walks typed synapses to surface
  knowledge that's connected, not just word-matched — the key gap RAG misses.
- **Real firewall.** The PreToolUse hook blocks forbidden reads at the tool
  layer; it isn't a polite request.
- **No drift.** The knowledge base only changes through `review`. `history.jsonl`
  is an append-only provenance log — every truth is traceable.

## License

[**PolyForm Noncommercial 1.0.0**](LICENSE) — free for personal, research,
hobby, educational, charitable, and government use.

**Commercial use requires a paid license.** If you want to use GENOME inside a
for-profit company, in a paid product or service, or as part of any
revenue-generating activity, see the "Commercial Licensing" section at the
bottom of [LICENSE](LICENSE).
