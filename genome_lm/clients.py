"""Backend clients.

Two backends are supported, both exposing the tiny slice of the Anthropic SDK
that the rest of the codebase touches:
`client.messages.create(model=..., max_tokens=..., messages=[...])`.

1. `api` — the official `anthropic` Python SDK. Requires `ANTHROPIC_API_KEY`,
   billed per token via console.anthropic.com.

2. `claude-code` — wraps the locally installed `claude` CLI. Auth comes from
   `claude login` (Max subscription, Team plan, etc.). No API key needed; calls
   count against your Claude.ai subscription quota. Each request spawns a
   subprocess, so it is slower than the SDK.

Both backends are drop-in interchangeable in `harness/run_longmemeval.py`.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class _Block:
    text: str
    type: str = "text"


@dataclass
class _Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class _Response:
    content: list[_Block]
    usage: _Usage = field(default_factory=_Usage)


class _ClaudeCodeMessages:
    def __init__(self, parent: "ClaudeCodeClient") -> None:
        self._parent = parent

    def create(
        self,
        model: str,
        max_tokens: int,
        messages: list[dict],
    ) -> _Response:
        # Flatten the message list into a single prompt for `claude -p`.
        # Claude Code's print mode is single-shot text-in / text-out — exactly
        # what we want here. The harness never asks the model to use tools.
        parts: list[str] = []
        for m in messages:
            content = m.get("content", "")
            if isinstance(content, list):
                content = "".join(
                    b.get("text", "") if isinstance(b, dict) else str(b)
                    for b in content
                )
            role = m.get("role", "user")
            if role == "assistant":
                parts.append(f"Assistant: {content}")
            else:
                parts.append(str(content))
        prompt = "\n\n".join(parts)

        cmd = [
            self._parent._bin,
            "-p",
            "--model", model,
            "--output-format", "json",
        ]
        try:
            result = subprocess.run(
                cmd,
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
                timeout=self._parent._timeout,
            )
        except subprocess.TimeoutExpired as e:
            raise RuntimeError(
                f"claude CLI timed out after {self._parent._timeout}s"
            ) from e

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(
                f"claude CLI failed (exit {result.returncode}): {err[:500]}"
            )

        text = ""
        in_tok = 0
        out_tok = 0
        stdout = (result.stdout or "").strip()
        try:
            payload = json.loads(stdout)
            # Print mode JSON shape: { "result": "...", "usage": {...}, ... }
            text = payload.get("result", "") or ""
            usage = payload.get("usage", {}) or {}
            in_tok = int(usage.get("input_tokens", 0) or 0)
            out_tok = int(usage.get("output_tokens", 0) or 0)
        except json.JSONDecodeError:
            text = stdout

        return _Response(
            content=[_Block(text=text)],
            usage=_Usage(input_tokens=in_tok, output_tokens=out_tok),
        )


class ClaudeCodeClient:
    """Drop-in replacement for `anthropic.Anthropic` using the local Claude
    Code CLI. Auth comes from `claude login`; no API key needed.
    """

    def __init__(self, bin_path: Optional[str] = None, timeout: int = 300) -> None:
        resolved = bin_path or shutil.which("claude")
        if not resolved:
            raise RuntimeError(
                "claude CLI not found in PATH. Install Claude Code:\n"
                "  npm install -g @anthropic-ai/claude-code\n"
                "and authenticate once:\n"
                "  claude login"
            )
        self._bin = resolved
        self._timeout = timeout
        self.messages = _ClaudeCodeMessages(self)


def make_client(backend: str, api_key: Optional[str]) -> Any:
    """Return a client for the requested backend."""
    if backend == "claude-code":
        return ClaudeCodeClient()
    if backend == "api":
        if not api_key:
            raise RuntimeError(
                "backend=api but env var ANTHROPIC_API_KEY is not set.\n"
                "  export ANTHROPIC_API_KEY=sk-...  (or use --backend claude-code)"
            )
        try:
            from anthropic import Anthropic  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "anthropic SDK is not installed. "
                "Run: pip install -r requirements.txt"
            ) from e
        return Anthropic(api_key=api_key)
    raise ValueError(f"unknown backend: {backend!r}")
