# GENOME — Schema

## Atom (`genome/atoms.jsonl`)

One JSON object per line.

| Field        | Type      | Notes |
|--------------|-----------|-------|
| `id`         | string    | Format `type.slug.NNN` (e.g. `rule.no-backend.001`) |
| `type`       | enum      | `constraint` \| `decision` \| `fact` \| `known_failure` \| `command` \| `test_gate` \| `preference` |
| `statement`  | string    | The knowledge itself |
| `tags`       | string[]  | Search keys |
| `priority`   | enum      | `critical` \| `high` \| `normal` |
| `status`     | enum      | `verified` \| `stable` \| `stale` \| `deprecated` |
| `source`     | string    | Where it came from |
| `confidence` | number    | 0..1 |
| `supersedes` | string[]  | IDs of atoms this replaces |
| `fix`        | string    | Only for `known_failure`: the fix pattern |

## Synapse (`genome/synapses.jsonl`)

One JSON object per line.

| Field  | Type   | Notes |
|--------|--------|-------|
| `from` | string | Source atom ID |
| `to`   | string | Target atom ID |
| `type` | enum   | `constrains` \| `depends_on` \| `supersedes` \| `caused_by` \| `relates_to` \| `tested_by` |

Edges are treated **bidirectionally** during context expansion.

## Inbox (`.genome/inbox.json`)

Agent learning suggestions, awaiting review:

```json
{
  "new_atoms": [
    {
      "type": "fact",
      "statement": "...",
      "tags": ["..."],
      "priority": "normal",
      "status": "verified",
      "source": "where it came from",
      "confidence": 0.8,
      "supersedes": []
    }
  ],
  "stale_ids": ["atom-id-to-mark-stale"]
}
```

`reflex` converts each entry into a proposal — it never writes directly into the genome.

## Proposals (`.genome/proposals.jsonl`)

Review queue. One JSON per line:

```json
{
  "proposal_id": "prop.xxxxx.001",
  "created": "ISO-8601",
  "kind": "add" | "mark_stale",
  "payload": { /* atom shape, or { "atom_id": "..." } */ },
  "status": "pending" | "accepted" | "rejected"
}
```

## History (`genome/history.jsonl`)

Append-only provenance log. Never edit by hand.

## Firewall (`genome/firewall.json`)

```json
{ "mode": "block", "forbidden_globs": ["RUN_LOG.md", "archive/**", "..."] }
```

Paths matching any glob are blocked by the Claude Code PreToolUse hook
(`.genome/firewall-hook.mjs`).
