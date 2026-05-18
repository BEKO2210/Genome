"""GENOME-LM — research artifact for testing the lifecycle-vs-flat ablation."""
from genome_lm.clients import ClaudeCodeClient, make_client
from genome_lm.memory import Atom, Memory
from genome_lm.lifecycle import apply_lifecycle, mark_stale_by_age
from genome_lm.retrieve import retrieve, tokenize
from genome_lm.extract import extract_atoms

__all__ = [
    "Atom",
    "Memory",
    "apply_lifecycle",
    "mark_stale_by_age",
    "retrieve",
    "tokenize",
    "extract_atoms",
    "ClaudeCodeClient",
    "make_client",
]
