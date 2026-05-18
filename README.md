# GENOME-LM — Research Artifact

A minimal, reproducible test rig for **one** falsifiable hypothesis on the
[LongMemEval](https://github.com/xiaowu0162/LongMemEval) memory benchmark:

> Does an explicit knowledge-lifecycle layer (supersession + staleness) improve
> accuracy on knowledge-update tasks in agent memory — at equal or lower token
> cost — compared to flat top-k retrieval?

A single switch `--lifecycle {on,off}` flips between the two arms. **Extraction
runs identically in both arms**, so the LLM cost of extraction is *not* a
confounder. Only the lifecycle layer differs.

Python ≥ 3.11. One required external dependency: the official Anthropic Python
SDK. Offline except for LLM API calls.

## Layout

```
.
├── genome_lm/
│   ├── config.py       # defaults: model, seed, paths, token caps
│   ├── memory.py       # Atom dataclass + in-memory store
│   ├── extract.py      # LLM extraction (identical in both arms)
│   ├── lifecycle.py    # THE ABLATION: apply_lifecycle()
│   └── retrieve.py     # self-implemented BM25
├── harness/
│   ├── run_longmemeval.py   # the experiment runner
│   ├── judge.py             # LLM-as-judge (prompt loaded from EXPERIMENT.md)
│   └── report.py            # comparison tables, no smoothing
├── tests/test_lifecycle.py  # synthetic ablation test
├── data/               # LongMemEval JSON goes here (gitignored)
├── results/            # run outputs (gitignored)
├── EXPERIMENT.md       # pre-registration template — fill in BEFORE scoring
├── requirements.txt
└── LICENSE
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-...
```

## Dataset

1. Get LongMemEval-S from <https://github.com/xiaowu0162/LongMemEval>.
2. Place the JSON in `data/longmemeval_s.json`.

`data/` is gitignored — the dataset is never committed.

## Pre-registration (required before any scoring run)

Fill in `EXPERIMENT.md`:
- Replace every `<<PLACEHOLDER>>`: minimum delta in pp, minimum sample size per
  category per arm, minimum number of seeds, dataset commit SHA.
- Confirm the judge prompt.
- Check the `[ ]` box on the Status line.
- Commit the file.

The harness loads the judge prompt from `EXPERIMENT.md` at runtime, so locking
it in via commit means it cannot drift during a study.

## Example runs

```bash
# small smoke runs (5 questions each)
python -m harness.run_longmemeval --lifecycle off --limit 5
python -m harness.run_longmemeval --lifecycle on  --limit 5

# compare two result files
python -m harness.report results/run-off-*.json results/run-on-*.json
```

A single `--limit 5` run on Sonnet 4.6 costs a few cents. A full 500-question
run × 2 arms × extraction-per-turn is hundreds of LLM calls per question;
budget accordingly before you start.

## Tests

```bash
python -m unittest discover -s tests -v
```

## Reproducing

Each results file under `results/` records, automatically:
- full config (lifecycle, k, model, judge model, seed, limit),
- model id,
- dataset SHA-256 hash,
- seed,
- UTC timestamp,
- lifecycle mode.

To reproduce a run, use the same flags on the same dataset hash. Different
hash → different dataset, results are not comparable.

## Integrity rules (not negotiable)

1. No scoring runs before `EXPERIMENT.md` is filled out and committed.
2. No tuning against test answers.
3. Every run is kept, including failures and negative results.
4. Seeds, model ids, dataset hashes are recorded automatically.

A clean negative result ("the lifecycle layer does not help on these
categories") is a real result — it is reported, not discarded.

## License

[**PolyForm Noncommercial 1.0.0**](LICENSE) — free for personal, research,
hobby, educational, charitable, and government use.

**Commercial use requires a paid license.** See the "Commercial Licensing"
section at the bottom of [LICENSE](LICENSE).
