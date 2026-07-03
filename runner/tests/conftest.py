"""Pytest fixtures: ensure GA is importable from sys.path.

The bridge package imports GA modules (`agent_loop`, `ga`). Tests prefer the
user's external GA when explicitly provided, but CI can use Galley's pinned
managed GA payload so unit tests do not depend on a checkout outside the repo.

GA path resolves in this order:
  1. GA_PATH environment variable
  2. ~/Documents/GenericAgent (user's local install)
  3. managed-ga/code (repo-pinned managed runtime payload)

Tests that don't need GA still load fine (the path is just prepended;
imports happen lazily). Tests that need GA fail with a clear ImportError
if the path is wrong.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Never write .pyc into whichever GA checkout these tests import from:
# for the managed-ga fallback that pollutes the shipped payload (core's
# payload-hygiene test rejects __pycache__), and a user checkout is not
# ours to write into.
sys.dont_write_bytecode = True


def _is_ga_path(path: Path) -> bool:
    return path.is_dir() and (path / "agent_loop.py").is_file() and (path / "ga.py").is_file()


def _resolve_ga_path() -> str | None:
    env = os.environ.get("GA_PATH")
    if env:
        path = Path(env)
        return str(path) if _is_ga_path(path) else None
    default = Path.home() / "Documents" / "GenericAgent"
    if _is_ga_path(default):
        return str(default)
    managed = _REPO_ROOT / "managed-ga" / "code"
    return str(managed) if _is_ga_path(managed) else None


_GA_PATH = _resolve_ga_path()
if _GA_PATH and _GA_PATH not in sys.path:
    sys.path.insert(0, _GA_PATH)
