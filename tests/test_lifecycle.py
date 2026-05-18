"""Synthetic acceptance test for the lifecycle ablation.

Verifies the contract from EXPERIMENT.md: with two atoms about the same
subject_key, `--lifecycle on` supersedes the older one and retrieval returns
only the newer; `--lifecycle off` leaves both current and retrieval may return
the outdated atom.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from genome_lm.lifecycle import apply_lifecycle
from genome_lm.memory import Atom, Memory
from genome_lm.retrieve import retrieve


def _ingest(memory: Memory, atoms: list[Atom], lifecycle_enabled: bool) -> None:
    for a in atoms:
        apply_lifecycle(memory, a, enabled=lifecycle_enabled)
        memory.add(a)


class LifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.older = Atom(
            statement="The user lives in Berlin.",
            atom_type="fact",
            subject_key="user.home_city",
            turn_index=2,
            source_session="s1",
        )
        self.newer = Atom(
            statement="The user lives in Munich.",
            atom_type="fact",
            subject_key="user.home_city",
            turn_index=7,
            source_session="s2",
        )

    def test_lifecycle_on_supersedes_older(self) -> None:
        mem = Memory()
        _ingest(mem, [self.older, self.newer], lifecycle_enabled=True)
        older_after = mem.get(self.older.id)
        newer_after = mem.get(self.newer.id)
        assert older_after is not None and newer_after is not None
        self.assertEqual(older_after.status, "superseded")
        self.assertEqual(newer_after.status, "current")
        self.assertIn(self.older.id, self.newer.supersedes)

        results = retrieve(mem, "Where does the user live?", k=5, lifecycle_enabled=True)
        ids = [a.id for a in results]
        self.assertIn(self.newer.id, ids)
        self.assertNotIn(self.older.id, ids)

    def test_lifecycle_off_keeps_both_current(self) -> None:
        mem = Memory()
        _ingest(mem, [self.older, self.newer], lifecycle_enabled=False)
        older_after = mem.get(self.older.id)
        newer_after = mem.get(self.newer.id)
        assert older_after is not None and newer_after is not None
        self.assertEqual(older_after.status, "current")
        self.assertEqual(newer_after.status, "current")
        self.assertEqual(self.newer.supersedes, [])

        results = retrieve(mem, "Where does the user live?", k=5, lifecycle_enabled=False)
        ids = {a.id for a in results}
        # Flat baseline retrieval can — and on this query, must — surface the
        # outdated atom alongside the newer one.
        self.assertTrue({self.older.id, self.newer.id}.issubset(ids))

    def test_subject_key_mismatch_does_not_supersede(self) -> None:
        mem = Memory()
        unrelated = Atom(
            statement="The user has a cat named Mochi.",
            atom_type="fact",
            subject_key="user.pet.name",
            turn_index=3,
            source_session="s1",
        )
        _ingest(mem, [unrelated, self.newer], lifecycle_enabled=True)
        # Different subject_key → the cat atom is NOT touched.
        self.assertEqual(mem.get(unrelated.id).status, "current")
        self.assertEqual(self.newer.supersedes, [])


if __name__ == "__main__":
    unittest.main()
