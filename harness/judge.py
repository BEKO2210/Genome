"""LLM-as-judge scoring.

The judge prompt is NOT hard-coded in this file. It is loaded from
`EXPERIMENT.md` at runtime so it can be locked in via commit before the first
scoring run.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from genome_lm.config import EXPERIMENT_FILE, JUDGE_MAX_TOKENS

JUDGE_SECTION_HEADER: str = "# Fixer Judge-Prompt"


class JudgeError(RuntimeError):
    pass


def load_judge_prompt(path: Optional[Path] = None) -> str:
    """Return the body of the '# Fixer Judge-Prompt' section in EXPERIMENT.md."""
    p = Path(path) if path is not None else EXPERIMENT_FILE
    if not p.exists():
        raise JudgeError(f"EXPERIMENT.md not found at {p}. Run from the project root.")
    text = p.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^{re.escape(JUDGE_SECTION_HEADER)}\s*\n(.*?)(?=^# |\Z)",
        re.DOTALL | re.MULTILINE,
    )
    m = pattern.search(text)
    if not m:
        raise JudgeError(
            f'EXPERIMENT.md is missing the "{JUDGE_SECTION_HEADER}" section.'
        )
    body = m.group(1).strip()
    if not body:
        raise JudgeError(
            "The judge prompt in EXPERIMENT.md is empty. Fill it before running scoring."
        )
    if "<<" in body and ">>" in body:
        raise JudgeError(
            "The judge prompt in EXPERIMENT.md still contains << >> placeholders. "
            "Replace them with the final prompt and commit before scoring."
        )
    return body


def _render(template: str, question: str, reference: str, answer: str) -> str:
    return (
        template
        .replace("{{question}}", question)
        .replace("{{reference}}", reference)
        .replace("{{answer}}", answer)
    )


def judge_answer(
    judge_prompt_template: str,
    question: str,
    reference_answer: str,
    model_answer: str,
    client,
    model: str,
) -> bool:
    """Return True iff the candidate is judged correct vs the reference."""
    rendered = _render(judge_prompt_template, question, reference_answer, model_answer)
    response = client.messages.create(
        model=model,
        max_tokens=JUDGE_MAX_TOKENS,
        messages=[{"role": "user", "content": rendered}],
    )
    raw = "".join(
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", "") == "text"
    ).strip().lower()
    if not raw:
        return False
    # Look only at the first non-empty line for the verdict.
    first_line = next((ln for ln in raw.splitlines() if ln.strip()), "")
    if re.search(r"\b(yes|correct|true|1)\b", first_line):
        return True
    if re.search(r"\b(no|incorrect|wrong|false|0)\b", first_line):
        return False
    # Unclear verdict → conservatively False (never silently correct).
    return False
