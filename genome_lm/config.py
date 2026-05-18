"""Defaults shared across the package."""
from pathlib import Path

PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
DATA_DIR: Path = PROJECT_ROOT / "data"
RESULTS_DIR: Path = PROJECT_ROOT / "results"
EXPERIMENT_FILE: Path = PROJECT_ROOT / "EXPERIMENT.md"

DEFAULT_MODEL: str = "claude-sonnet-4-6"
DEFAULT_K: int = 10
DEFAULT_SEED: int = 42

EXTRACTION_MAX_TOKENS: int = 1024
ANSWER_MAX_TOKENS: int = 512
JUDGE_MAX_TOKENS: int = 256

ANTHROPIC_API_KEY_ENV: str = "ANTHROPIC_API_KEY"
