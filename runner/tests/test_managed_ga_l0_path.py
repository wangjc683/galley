"""Managed-GA patch 0001: memory distillation reads L0 from the state root.

``start_long_term_update`` hands the model L0
(``memory/memory_management_sop.md``) and, when the file is missing, says
"Memory Management SOP not found. Do not update memory." Upstream
``1a44b3f`` (GA baseline ``d66509b``) anchors that path to the code dir; the
managed payload ships without ``memory/`` (it lives in the state root,
``GALLEY_GA_STATE_ROOT``), so the unpatched line would turn distillation off
for every managed session. ``0001`` points it at ``state_path``. Before the
bump the path was relative to the process cwd and only the state root
(desktop, WeChat) found it; Feishu, Telegram and Discord run from
``im/<platform>``.

The handler runs in a child process so the cwd and ``state_dir`` (read at
import) are the ones under test.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
_MANAGED_GA_CODE = _REPO / "managed-ga" / "code"

_CHILD = """
import contextlib, io, json, os, sys
sys.path.insert(0, sys.argv[1])
with contextlib.redirect_stdout(io.StringIO()):
    import ga
handler = ga.GenericAgentHandler(None, [], os.getcwd())
handler.current_turn = 10  # the tool refuses before turn 10
gen = handler.do_start_long_term_update({}, None)
try:
    while True:
        next(gen)
except StopIteration as stop:
    print(json.dumps(stop.value.data))
"""


@pytest.mark.parametrize("cwd_rel", [".", "im/feishu"], ids=["state-root", "im-channel"])
def test_long_term_update_reads_l0_from_state_root(tmp_path: Path, cwd_rel: str) -> None:
    state_root = tmp_path / "managed-ga-state"
    (state_root / "memory").mkdir(parents=True)
    (state_root / "memory" / "memory_management_sop.md").write_text("L0 marker\n", encoding="utf-8")
    cwd = state_root / cwd_rel
    cwd.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GALLEY_GA_STATE_ROOT": str(state_root), "PYTHONDONTWRITEBYTECODE": "1"}

    proc = subprocess.run(
        [sys.executable, "-B", "-c", _CHILD, str(_MANAGED_GA_CODE)],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    assert result.startswith("This is L0:"), result
    assert "L0 marker" in result
