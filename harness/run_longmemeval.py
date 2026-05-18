"""The experiment runner. Drives one ablation arm end-to-end."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from genome_lm.config import (
    ANSWER_MAX_TOKENS,
    ANTHROPIC_API_KEY_ENV,
    DATA_DIR,
    DEFAULT_K,
    DEFAULT_MODEL,
    DEFAULT_SEED,
    RESULTS_DIR,
)
from genome_lm.extract import extract_atoms
from genome_lm.lifecycle import apply_lifecycle
from genome_lm.memory import Atom, Memory
from genome_lm.retrieve import retrieve
from harness.judge import judge_answer, load_judge_prompt

DATASET_FILENAMES: list[str] = [
    "longmemeval_s.json",
    "longmemeval-s.json",
    "longmemeval.json",
]


def _find_dataset(data_dir: Path) -> Optional[Path]:
    if not data_dir.exists():
        return None
    for name in DATASET_FILENAMES:
        p = data_dir / name
        if p.exists():
            return p
    candidates = sorted(data_dir.glob("*.json"))
    return candidates[0] if candidates else None


def _dataset_help_msg(data_dir: Path) -> str:
    return (
        f"\nNo LongMemEval dataset found in {data_dir}/.\n"
        "Download LongMemEval-S from the official repo:\n"
        "  https://github.com/xiaowu0162/LongMemEval\n"
        f"and place the JSON (typically longmemeval_s.json) inside {data_dir}/.\n"
    )


def _hash_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _flatten_turn(turn: Any) -> Optional[str]:
    """Normalize a single turn into 'role: content' text. Handles dict and str."""
    if isinstance(turn, dict):
        role = turn.get("role", "")
        content = turn.get("content") or turn.get("text") or ""
        if not content:
            return None
        return f"[{role}] {content}" if role else str(content)
    if isinstance(turn, str):
        return turn
    return None


def _extract_question_fields(item: dict) -> dict:
    """Tolerate small schema variations across LongMemEval JSON dumps."""
    qid = item.get("question_id") or item.get("id") or item.get("qid")
    qtype = (
        item.get("question_type")
        or item.get("category")
        or item.get("type")
        or "unknown"
    )
    question = item.get("question") or item.get("query")
    answer = (
        item.get("answer")
        or item.get("reference_answer")
        or item.get("gold_answer")
        or ""
    )
    sessions = (
        item.get("haystack_sessions")
        or item.get("sessions")
        or item.get("history_sessions")
        or []
    )
    session_ids = (
        item.get("haystack_session_ids")
        or item.get("session_ids")
        or [f"sess-{i}" for i in range(len(sessions))]
    )
    return {
        "question_id": qid,
        "category": qtype,
        "question": question,
        "answer": answer,
        "sessions": sessions,
        "session_ids": session_ids,
    }


def _build_answer_prompt(question: str, atoms: list[Atom]) -> str:
    if atoms:
        bullets = "\n".join(f"- {a.statement}" for a in atoms)
    else:
        bullets = "- (no relevant memory was retrieved)"
    return (
        "You are a memory-augmented assistant. Use ONLY the memories below to answer.\n"
        "If the memories don't contain the answer, say so plainly. Be concise.\n\n"
        f"Memories:\n{bullets}\n\n"
        f"Question: {question}\n\n"
        "Answer:"
    )


def _ingest_sessions(
    sessions: list,
    session_ids: list[str],
    lifecycle_enabled: bool,
    client,
    model: str,
    memory: Memory,
) -> dict:
    """Walk sessions in order, extract atoms, apply lifecycle in real time."""
    turn_index = 0
    for sess_idx, session in enumerate(sessions):
        sess_id = (
            session_ids[sess_idx]
            if sess_idx < len(session_ids)
            else f"sess-{sess_idx}"
        )
        if isinstance(session, dict):
            turns = session.get("turns") or session.get("messages") or []
        elif isinstance(session, list):
            turns = session
        else:
            turns = []
        for turn in turns:
            text = _flatten_turn(turn)
            if not text:
                continue
            atoms = extract_atoms(
                turn_text=text,
                turn_index=turn_index,
                source_session=str(sess_id),
                client=client,
                model=model,
            )
            for atom in atoms:
                apply_lifecycle(memory, atom, enabled=lifecycle_enabled)
                memory.add(atom)
            turn_index += 1
    return {"ingest_turns": turn_index}


def _make_client(api_key: str):
    try:
        from anthropic import Anthropic  # type: ignore
    except ImportError:
        print(
            "error: the anthropic SDK is not installed. "
            "Run: pip install -r requirements.txt",
            file=sys.stderr,
        )
        sys.exit(2)
    return Anthropic(api_key=api_key)


def _answer_question(client, model: str, question: str, retrieved: list[Atom]) -> tuple[str, int]:
    prompt = _build_answer_prompt(question, retrieved)
    response = client.messages.create(
        model=model,
        max_tokens=ANSWER_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", "") == "text"
    ).strip()
    usage = getattr(response, "usage", None)
    tokens = (
        getattr(usage, "input_tokens", 0) + getattr(usage, "output_tokens", 0)
        if usage else 0
    )
    return text, int(tokens)


def run(args: argparse.Namespace) -> Path:
    api_key = os.environ.get(ANTHROPIC_API_KEY_ENV)
    if not api_key:
        print(
            f"error: env var {ANTHROPIC_API_KEY_ENV} is not set.\n"
            "  export ANTHROPIC_API_KEY=sk-...",
            file=sys.stderr,
        )
        sys.exit(2)

    data_dir = Path(args.data_dir).resolve()
    dataset_path = _find_dataset(data_dir)
    if not dataset_path:
        print(_dataset_help_msg(data_dir), file=sys.stderr)
        sys.exit(2)

    try:
        judge_prompt = load_judge_prompt()
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)

    random.seed(args.seed)

    with dataset_path.open("r", encoding="utf-8") as f:
        dataset = json.load(f)
    if not isinstance(dataset, list):
        print(
            f"error: expected a JSON array at {dataset_path}, "
            f"got {type(dataset).__name__}.",
            file=sys.stderr,
        )
        sys.exit(2)

    items = dataset[: args.limit] if args.limit and args.limit > 0 else dataset
    client = _make_client(api_key)

    RESULTS_DIR.mkdir(exist_ok=True, parents=True)
    if args.out:
        out_path = Path(args.out).resolve()
    else:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out_path = RESULTS_DIR / f"run-{args.lifecycle}-{ts}.json"
    out_path.parent.mkdir(exist_ok=True, parents=True)

    metadata = {
        "config": {
            "lifecycle": args.lifecycle,
            "k": args.k,
            "limit": args.limit,
            "model": args.model,
            "judge_model": args.judge_model,
            "seed": args.seed,
            "data_dir": str(data_dir),
            "dataset_file": dataset_path.name,
        },
        "model": args.model,
        "dataset_hash": _hash_file(dataset_path),
        "seed": args.seed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "lifecycle_mode": args.lifecycle,
    }

    lifecycle_enabled = args.lifecycle == "on"
    questions_out: list[dict] = []
    total = len(items)
    print(
        f"running {total} question(s) · lifecycle={args.lifecycle} · "
        f"k={args.k} · model={args.model}"
    )

    for idx, item in enumerate(items, 1):
        q = _extract_question_fields(item)
        if not q["question"]:
            print(f"  [{idx}/{total}] skipped (no question text)")
            continue

        memory = Memory()
        t0 = time.time()
        _ingest_sessions(
            sessions=q["sessions"],
            session_ids=q["session_ids"],
            lifecycle_enabled=lifecycle_enabled,
            client=client,
            model=args.model,
            memory=memory,
        )
        retrieved = retrieve(
            memory, q["question"], k=args.k, lifecycle_enabled=lifecycle_enabled,
        )
        try:
            model_answer, ans_tokens = _answer_question(
                client, args.model, q["question"], retrieved,
            )
        except Exception as e:
            print(f"  [{idx}/{total}] answer error: {e}")
            model_answer, ans_tokens = "", 0

        try:
            correct = judge_answer(
                judge_prompt_template=judge_prompt,
                question=q["question"],
                reference_answer=q["answer"],
                model_answer=model_answer,
                client=client,
                model=args.judge_model,
            )
        except Exception as e:
            print(f"  [{idx}/{total}] judge error: {e}")
            correct = False

        latency = time.time() - t0
        questions_out.append({
            "question_id": q["question_id"],
            "category": q["category"],
            "correct": bool(correct),
            "answer_tokens": int(ans_tokens),
            "latency_s": round(latency, 3),
            "model_answer": model_answer,
            "reference_answer": q["answer"],
            "retrieved_atom_ids": [a.id for a in retrieved],
            "memory_atoms_total": len(memory.all()),
            "memory_atoms_current": len(memory.current()),
        })
        print(
            f"  [{idx}/{total}] {q['category']}  correct={correct}  "
            f"tokens={ans_tokens}  t={latency:.1f}s"
        )

    payload = {"metadata": metadata, "questions": questions_out}
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nwrote {out_path}")
    return out_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m harness.run_longmemeval",
        description="Run one ablation arm of the GENOME-LM experiment on LongMemEval.",
    )
    p.add_argument(
        "--lifecycle", choices=["on", "off"], required=True,
        help="Knowledge-lifecycle layer: on = supersede, off = flat baseline.",
    )
    p.add_argument(
        "--limit", type=int, default=0,
        help="Number of questions to run (0 = all).",
    )
    p.add_argument(
        "--k", type=int, default=DEFAULT_K,
        help=f"Top-k for retrieval. Default {DEFAULT_K}.",
    )
    p.add_argument(
        "--model", default=DEFAULT_MODEL,
        help=f"Anthropic model id for extract + answer. Default {DEFAULT_MODEL}.",
    )
    p.add_argument(
        "--judge-model", default=DEFAULT_MODEL,
        help="Anthropic model id used by the judge.",
    )
    p.add_argument(
        "--seed", type=int, default=DEFAULT_SEED,
        help=f"Random seed. Default {DEFAULT_SEED}.",
    )
    p.add_argument(
        "--data-dir", default=str(DATA_DIR),
        help=f"Directory containing the dataset JSON. Default {DATA_DIR}.",
    )
    p.add_argument(
        "--out", default=None,
        help="Output JSON path (default: results/run-<mode>-<ts>.json).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    run(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
