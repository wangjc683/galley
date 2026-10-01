"""Managed-GA patch 0027: ``llmcore.auto_make_url`` treats a qualified version
segment (``/v1beta``) as a version, like ``/v1`` (galley#32).

Google Gemini's OpenAI-compatible base is
``https://generativelanguage.googleapis.com/v1beta/openai/``. Upstream's rule
only knew all-digit versions and inserted a second ``/v1/``, so the
documented base failed. Core's connection test and model-list probe
(``core/src/managed_model_probe.rs``) apply the same rule; the cases live
once, in that file's ``AUTO_MAKE_URL_CASES``, and are parsed from it here so
the probe and the engine cannot drift apart.

The function is loaded from the shipped payload's source without importing
llmcore (which pulls in requests / urllib3 and patches them at import).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

_REPO = Path(__file__).resolve().parents[2]
_LLMCORE = _REPO / "managed-ga" / "code" / "llmcore.py"
_PROBE = _REPO / "core" / "src" / "managed_model_probe.rs"

_GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _load_auto_make_url() -> Callable[[str, str], str]:
    tree = ast.parse(_LLMCORE.read_text(encoding="utf-8"))
    func = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "auto_make_url"
    )
    namespace: dict[str, Any] = {"re": re}
    exec(compile(ast.Module(body=[func], type_ignores=[]), str(_LLMCORE), "exec"), namespace)
    loaded: Callable[[str, str], str] = namespace["auto_make_url"]
    return loaded


def _rust_cases() -> list[tuple[str, str, str]]:
    source = _PROBE.read_text(encoding="utf-8")
    table = re.search(
        r"const AUTO_MAKE_URL_CASES: &\[\(&str, &str, &str\)\] = &\[(.*?)\n\s*\];",
        source,
        re.DOTALL,
    )
    assert table, f"AUTO_MAKE_URL_CASES not found in {_PROBE}"
    return re.findall(r'\(\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",?\s*\)', table.group(1))


_CASES = _rust_cases()


def test_case_table_is_parsed_from_the_probe() -> None:
    # A regex that silently matched nothing would make every case below vacuous.
    assert len(_CASES) >= 20
    assert (_GEMINI, "chat/completions", _GEMINI + "chat/completions") in _CASES
    assert any(base.endswith("/vendor/api") for base, _path, _expected in _CASES)


@pytest.mark.parametrize(("base", "path", "expected"), _CASES)
def test_auto_make_url_agrees_with_core_probe(base: str, path: str, expected: str) -> None:
    assert _load_auto_make_url()(base, path) == expected
