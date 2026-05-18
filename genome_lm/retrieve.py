"""Self-implemented BM25 retrieval over atom statements.

The retrieval pool is the only place the lifecycle layer affects retrieval:
- lifecycle_enabled=True  -> pool = memory.current()
- lifecycle_enabled=False -> pool = memory.all()  (flat top-k over everything)
"""
from __future__ import annotations

import math
import re
from collections import Counter

from genome_lm.memory import Atom, Memory

BM25_K1: float = 1.5
BM25_B: float = 0.75
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return [w for w in _TOKEN_RE.findall((text or "").lower()) if len(w) > 1]


def _idf(N: int, df: int) -> float:
    return math.log((N - df + 0.5) / (df + 0.5) + 1.0)


def _score(
    query_tokens: list[str],
    doc_tokens: list[str],
    dfs: dict[str, int],
    N: int,
    avgdl: float,
) -> float:
    if not doc_tokens:
        return 0.0
    tf = Counter(doc_tokens)
    dl = len(doc_tokens)
    score = 0.0
    for q in query_tokens:
        df = dfs.get(q, 0)
        if df == 0:
            continue
        f = tf[q]
        if f == 0:
            continue
        idf = _idf(N, df)
        numerator = f * (BM25_K1 + 1.0)
        denominator = f + BM25_K1 * (1.0 - BM25_B + BM25_B * dl / max(avgdl, 1.0))
        score += idf * numerator / denominator
    return score


def retrieve(
    memory: Memory,
    query: str,
    k: int,
    lifecycle_enabled: bool,
) -> list[Atom]:
    pool: list[Atom] = memory.current() if lifecycle_enabled else memory.all()
    if not pool or k <= 0:
        return []
    docs = [tokenize(a.statement) for a in pool]
    N = len(docs)
    avgdl = sum(len(d) for d in docs) / max(N, 1)
    dfs: dict[str, int] = {}
    for d in docs:
        for term in set(d):
            dfs[term] = dfs.get(term, 0) + 1
    qtok = tokenize(query)
    if not qtok:
        return []
    scored: list[tuple[Atom, float]] = []
    for atom, doc in zip(pool, docs):
        s = _score(qtok, doc, dfs, N, avgdl)
        if s > 0:
            scored.append((atom, s))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [a for a, _ in scored[:k]]
