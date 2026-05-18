"""LLM-backed extraction of session turns into atoms.

This module is IDENTICAL across both ablation arms (`--lifecycle on/off`).
It must never branch on the lifecycle flag — that would make it a confounder.
"""
from __future__ import annotations

import json
import re

from genome_lm.config import EXTRACTION_MAX_TOKENS
from genome_lm.memory import Atom

EXTRACTION_PROMPT: str = """You receive a single conversation turn from a long-running session between a user and an assistant.
Your job: extract every distinct factual or preference claim into atomic statements.

For each atom, produce a strict JSON object with:
  - "statement": one self-contained sentence in plain English.
  - "atom_type": one of "fact", "preference", "intent", "event".
  - "subject_key": a stable dotted key identifying *what* the statement is about,
    e.g. "user.job", "user.home_city", "user.allergy", "user.pet.name".
    Use the same subject_key for later turns that update the same attribute.

Return a JSON array (possibly empty). NO surrounding text, NO markdown fences.

Turn:
\"\"\"{turn}\"\"\"
"""


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_extraction(raw: str) -> list[dict]:
    raw = _strip_code_fence(raw)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    valid: list[dict] = []
    for item in data:
        if (
            isinstance(item, dict)
            and isinstance(item.get("statement"), str) and item["statement"].strip()
            and isinstance(item.get("subject_key"), str) and item["subject_key"].strip()
        ):
            valid.append({
                "statement": item["statement"].strip(),
                "atom_type": item.get("atom_type", "fact"),
                "subject_key": item["subject_key"].strip(),
            })
    return valid


def extract_atoms(
    turn_text: str,
    turn_index: int,
    source_session: str,
    client,
    model: str,
) -> list[Atom]:
    """Extract atomic facts/preferences from one turn. Identical in both arms."""
    if not turn_text or not turn_text.strip():
        return []
    prompt = EXTRACTION_PROMPT.format(turn=turn_text.strip())
    response = client.messages.create(
        model=model,
        max_tokens=EXTRACTION_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", "") == "text"
    )
    parsed = _parse_extraction(raw)
    return [
        Atom(
            statement=item["statement"],
            atom_type=item["atom_type"],
            subject_key=item["subject_key"],
            turn_index=turn_index,
            source_session=source_session,
        )
        for item in parsed
    ]
