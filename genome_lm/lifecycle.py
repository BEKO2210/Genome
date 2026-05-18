"""The single ablatable mechanism: knowledge supersession.

`apply_lifecycle` is the ONLY behavioral difference between the two arms of the
experiment. `extract_atoms` runs identically in both arms, so the LLM cost is
not a confounder — only the lifecycle layer differs.
"""
from __future__ import annotations

from typing import Optional

from genome_lm.memory import Atom, Memory


def apply_lifecycle(memory: Memory, new_atom: Atom, enabled: bool) -> None:
    """Mark prior atoms with the same subject_key as superseded by new_atom.

    enabled=True:
        For every prior atom in `memory` with the same `subject_key` and a
        smaller `turn_index` that is still "current", set its status to
        "superseded" and append its id to `new_atom.supersedes`. The new atom
        keeps status "current".

    enabled=False:
        No-op. Every atom stays "current" — the flat baseline that stacks all
        facts together.
    """
    if not enabled:
        return
    for prior in memory.all():
        if prior.id == new_atom.id:
            continue
        if prior.subject_key != new_atom.subject_key:
            continue
        if prior.turn_index >= new_atom.turn_index:
            continue
        if prior.status != "current":
            continue
        prior.status = "superseded"
        if prior.id not in new_atom.supersedes:
            new_atom.supersedes.append(prior.id)


def mark_stale_by_age(memory: Memory, max_age_turns: Optional[int] = None) -> None:
    """Placeholder for v2 age-based staleness. Not active in v1."""
    return
