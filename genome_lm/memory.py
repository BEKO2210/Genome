"""Atom store: a flat, in-memory list of typed knowledge atoms."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Atom:
    statement: str
    atom_type: str
    subject_key: str
    turn_index: int
    source_session: str
    status: str = "current"  # one of: "current", "superseded", "stale"
    supersedes: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "statement": self.statement,
            "atom_type": self.atom_type,
            "subject_key": self.subject_key,
            "turn_index": self.turn_index,
            "source_session": self.source_session,
            "status": self.status,
            "supersedes": list(self.supersedes),
        }


class Memory:
    def __init__(self) -> None:
        self._atoms: list[Atom] = []
        self._by_id: dict[str, Atom] = {}

    def add(self, atom: Atom) -> None:
        self._atoms.append(atom)
        self._by_id[atom.id] = atom

    def get(self, atom_id: str) -> Optional[Atom]:
        return self._by_id.get(atom_id)

    def all(self) -> list[Atom]:
        return list(self._atoms)

    def current(self) -> list[Atom]:
        return [a for a in self._atoms if a.status == "current"]

    def __len__(self) -> int:
        return len(self._atoms)
