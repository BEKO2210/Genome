"""Aggregate one or two results JSONs into a comparison table.

Pure rendering — no smoothing, no interpretation. The numbers are what they are.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Optional


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _per_category(data: dict) -> tuple[dict, dict]:
    by_cat: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"correct": [], "tokens": [], "latency": []}
    )
    overall = {"correct": [], "tokens": [], "latency": []}
    for q in data.get("questions", []):
        cat = q.get("category", "unknown")
        c = 1.0 if q.get("correct") else 0.0
        t = float(q.get("answer_tokens", 0) or 0)
        lat = float(q.get("latency_s", 0) or 0)
        by_cat[cat]["correct"].append(c)
        by_cat[cat]["tokens"].append(t)
        by_cat[cat]["latency"].append(lat)
        overall["correct"].append(c)
        overall["tokens"].append(t)
        overall["latency"].append(lat)

    def mean(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    cat_summary = {
        cat: {
            "n": len(d["correct"]),
            "accuracy": mean(d["correct"]),
            "mean_tokens": mean(d["tokens"]),
            "mean_latency": mean(d["latency"]),
        }
        for cat, d in by_cat.items()
    }
    overall_summary = {
        "n": len(overall["correct"]),
        "accuracy": mean(overall["correct"]),
        "mean_tokens": mean(overall["tokens"]),
        "mean_latency": mean(overall["latency"]),
    }
    return cat_summary, overall_summary


def _fmt_row(cells: list[str], widths: list[int]) -> str:
    return "  ".join(c.ljust(w) for c, w in zip(cells, widths))


def _render_single(name: str, cat: dict, overall: dict) -> str:
    rows: list[list[str]] = [["category", "n", "accuracy", "tokens", "latency_s"]]
    for c, d in sorted(cat.items()):
        rows.append([
            c, str(d["n"]),
            f"{d['accuracy']:.3f}",
            f"{d['mean_tokens']:.1f}",
            f"{d['mean_latency']:.2f}",
        ])
    rows.append([
        "OVERALL", str(overall["n"]),
        f"{overall['accuracy']:.3f}",
        f"{overall['mean_tokens']:.1f}",
        f"{overall['mean_latency']:.2f}",
    ])
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = [f"=== {name} ==="]
    lines.append(_fmt_row(rows[0], widths))
    lines.append("  ".join("-" * w for w in widths))
    for r in rows[1:]:
        lines.append(_fmt_row(r, widths))
    return "\n".join(lines)


def _render_compare(
    a_name: str, a_cat: dict, a_overall: dict,
    b_name: str, b_cat: dict, b_overall: dict,
) -> str:
    cats = sorted(set(a_cat) | set(b_cat))
    rows: list[list[str]] = [[
        "category",
        f"{a_name}.acc", f"{b_name}.acc", "Δacc(pp)",
        f"{a_name}.tok", f"{b_name}.tok", "Δtok",
        f"{a_name}.lat", f"{b_name}.lat",
    ]]
    empty = {"accuracy": 0.0, "mean_tokens": 0.0, "mean_latency": 0.0, "n": 0}
    for c in cats:
        a = a_cat.get(c, empty)
        b = b_cat.get(c, empty)
        d_acc = (a["accuracy"] - b["accuracy"]) * 100.0
        d_tok = a["mean_tokens"] - b["mean_tokens"]
        rows.append([
            c,
            f"{a['accuracy']:.3f}", f"{b['accuracy']:.3f}", f"{d_acc:+.1f}",
            f"{a['mean_tokens']:.1f}", f"{b['mean_tokens']:.1f}", f"{d_tok:+.1f}",
            f"{a['mean_latency']:.2f}", f"{b['mean_latency']:.2f}",
        ])
    d_acc = (a_overall["accuracy"] - b_overall["accuracy"]) * 100.0
    d_tok = a_overall["mean_tokens"] - b_overall["mean_tokens"]
    rows.append([
        "OVERALL",
        f"{a_overall['accuracy']:.3f}", f"{b_overall['accuracy']:.3f}", f"{d_acc:+.1f}",
        f"{a_overall['mean_tokens']:.1f}", f"{b_overall['mean_tokens']:.1f}", f"{d_tok:+.1f}",
        f"{a_overall['mean_latency']:.2f}", f"{b_overall['mean_latency']:.2f}",
    ])
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = [f"=== compare: {a_name} vs {b_name} ==="]
    lines.append(_fmt_row(rows[0], widths))
    lines.append("  ".join("-" * w for w in widths))
    for r in rows[1:]:
        lines.append(_fmt_row(r, widths))
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="python -m harness.report",
        description="Render results from one or more results JSONs.",
    )
    p.add_argument("results", nargs="+", type=Path, help="Path(s) to results JSON file(s).")
    p.add_argument(
        "--label", action="append", default=[],
        help="Optional label per input (in order). Defaults to the mode from metadata.",
    )
    args = p.parse_args(argv)

    summaries: list[tuple[str, dict, dict]] = []
    for i, path in enumerate(args.results):
        if not path.exists():
            print(f"error: {path} does not exist", file=sys.stderr)
            return 2
        data = _load(path)
        cat, overall = _per_category(data)
        if i < len(args.label):
            label = args.label[i]
        else:
            label = data.get("metadata", {}).get("lifecycle_mode") or path.stem
        summaries.append((label, cat, overall))

    if len(summaries) == 1:
        print(_render_single(*summaries[0]))
    elif len(summaries) == 2:
        a_name, a_cat, a_overall = summaries[0]
        b_name, b_cat, b_overall = summaries[1]
        print(_render_single(a_name, a_cat, a_overall))
        print()
        print(_render_single(b_name, b_cat, b_overall))
        print()
        print(_render_compare(a_name, a_cat, a_overall, b_name, b_cat, b_overall))
    else:
        for s in summaries:
            print(_render_single(*s))
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
