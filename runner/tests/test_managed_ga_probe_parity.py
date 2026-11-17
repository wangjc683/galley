"""Core's "Test model" sends the headers the managed engine sends.

"Test model" passing has to mean a conversation will pass, and a provider can
decide on headers alone: on 2026-11-17 the official Anthropic API refused a
subscription's API credit to a request that said it was Claude Code. Core's
probe (``core/src/managed_model_probe.rs``) cannot call the engine, so it
keeps a copy of the engine's values in one block of ``ENGINE_*`` constants.
This test reads those constants with regular expressions and the engine's own
values from the shipped payload's ``llmcore.py`` with ``ast`` (``llmcore`` is
not imported: it pulls in requests / urllib3 and patches them at import), and
compares them item by item.

When a baseline upgrade changes one of the engine's values, this test goes
red and names the Rust constant to update; nothing else needs to change.
Not compared, by design (the probe does not mirror them): OpenAI's
``Accept: text/event-stream`` (the engine streams, the probe does not), the
rest of the request body (system prompt, thinking and effort,
``cache_control``), the OpenAI ``responses`` endpoint, and the auth header
choice. The URL rule has its own test, ``test_managed_ga_url.py``.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
_LLMCORE = _REPO / "managed-ga" / "code" / "llmcore.py"
_PROBE = _REPO / "core" / "src" / "managed_model_probe.rs"

_ENGINE = ast.parse(_LLMCORE.read_text(encoding="utf-8"))
_RUST = _PROBE.read_text(encoding="utf-8")

# The flag managed patch 0032 computes in `raw_ask`: true when the request
# says it is Claude Code.
_IDENTITY_FLAG = "cc_identity"


def _fix(constant: str) -> str:
    return f"update {constant} in {_PROBE.relative_to(_REPO)}"


# --- Rust side -------------------------------------------------------------


def _rust_str(name: str) -> str:
    match = re.search(rf'const {name}: &str =\s*"([^"]*)";', _RUST)
    assert match, f"const {name}: &str not found in {_PROBE}"
    return match.group(1)


def _rust_usize(name: str) -> int:
    match = re.search(rf"const {name}: usize = (\d+);", _RUST)
    assert match, f"const {name}: usize not found in {_PROBE}"
    return int(match.group(1))


def _rust_str_array(name: str) -> list[str]:
    match = re.search(rf"const {name}: \[&str; \d+\] = \[(.*?)\];", _RUST, re.DOTALL)
    assert match, f"const {name}: [&str; N] not found in {_PROBE}"
    items = re.findall(r'"([^"]*)"|\b([A-Z][A-Z0-9_]*)\b', match.group(1))
    return [literal if literal or not ident else _rust_str(ident) for literal, ident in items]


def _rust_pairs(name: str) -> list[tuple[str, str]]:
    match = re.search(rf"const {name}: \[\(&str, &str\); \d+\] = \[(.*?)\];", _RUST, re.DOTALL)
    assert match, f"const {name}: [(&str, &str); N] not found in {_PROBE}"
    pairs: list[tuple[str, str]] = re.findall(r'\(\s*"([^"]*)",\s*"([^"]*)",?\s*\)', match.group(1))
    return pairs


def _rust_struct_fields(name: str) -> list[str]:
    match = re.search(rf"struct {name}<'a> \{{(.*?)\}}", _RUST, re.DOTALL)
    assert match, f"struct {name} not found in {_PROBE}"
    fields: list[str] = re.findall(r"(\w+): &'a str", match.group(1))
    return fields


# --- Engine side -----------------------------------------------------------


def _class(name: str) -> ast.ClassDef:
    found = [n for n in _ENGINE.body if isinstance(n, ast.ClassDef) and n.name == name]
    assert len(found) == 1, f"class {name} not found in {_LLMCORE}"
    return found[0]


def _function(name: str, scope: list[ast.stmt] | None = None) -> ast.FunctionDef:
    body = _ENGINE.body if scope is None else scope
    found = [n for n in body if isinstance(n, ast.FunctionDef) and n.name == name]
    assert len(found) == 1, f"def {name} not found in {_LLMCORE}"
    return found[0]


def _class_str(cls: str, attr: str) -> str:
    for node in _class(cls).body:
        if (
            isinstance(node, ast.Assign)
            and [ast.unparse(t) for t in node.targets] == [attr]
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            return node.value.value
    raise AssertionError(f"{cls}.{attr} = '...' not found in {_LLMCORE}")


def _statements(func: ast.FunctionDef) -> set[str]:
    return {ast.unparse(node) for node in ast.walk(func) if isinstance(node, ast.stmt)}


def _raw_ask() -> ast.FunctionDef:
    return _function("raw_ask", _class("NativeClaudeSession").body)


def _assigned(func: ast.FunctionDef, name: str) -> ast.expr:
    found = [
        node.value
        for node in ast.walk(func)
        if isinstance(node, ast.Assign) and [ast.unparse(t) for t in node.targets] == [name]
    ]
    assert len(found) == 1, f"{func.name}: one `{name} = ...` expected in {_LLMCORE}"
    return found[0]


def _header_dicts(func: ast.FunctionDef) -> list[ast.expr]:
    """The `headers = {...}` literal and every `headers.update(...)` argument."""
    found = [_assigned(func, "headers")]
    for node in ast.walk(func):
        if isinstance(node, ast.Call) and ast.unparse(node.func) == "headers.update":
            found.extend(node.args)
    return found


# Where a header literal sits relative to 0032's flag.
_ALWAYS, _IDENTITY, _NO_IDENTITY = "always", "identity", "no identity"


class _Headers:
    """Header literals in a request builder, by name: their static values and
    the branches (of `... if cc_identity else ...`) they appear in."""

    def __init__(self, exprs: list[ast.expr]) -> None:
        self.static: dict[str, set[str]] = {}
        self.dynamic: set[str] = set()
        self.where: dict[str, set[str]] = {}
        for expr in exprs:
            self._visit(expr, _ALWAYS)

    def _visit(self, node: ast.expr, where: str) -> None:
        if isinstance(node, ast.IfExp) and ast.unparse(node.test) == _IDENTITY_FLAG:
            self._visit(node.body, _IDENTITY)
            self._visit(node.orelse, _NO_IDENTITY)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=True):
                if key is None:  # `**{...}`
                    self._visit(value, where)
                    continue
                assert isinstance(key, ast.Constant) and isinstance(key.value, str)
                self.where.setdefault(key.value, set()).add(where)
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    self.static.setdefault(key.value, set()).add(value.value)
                else:
                    self.dynamic.add(key.value)

    def names(self, *, identity_only: bool) -> set[str]:
        """Sent on every request, or only on one that says it is Claude Code."""
        if identity_only:
            return {name for name, where in self.where.items() if where == {_IDENTITY}}
        return {
            name
            for name, where in self.where.items()
            if _ALWAYS in where or {_IDENTITY, _NO_IDENTITY} <= where
        }

    def static_pairs(self, names: set[str]) -> dict[str, str]:
        pairs: dict[str, str] = {}
        for name in names & self.static.keys():
            values = self.static[name]
            assert len(values) == 1, f"engine header {name} has several values {values}"
            pairs[name] = next(iter(values))
        return pairs


def _claude_headers() -> _Headers:
    return _Headers(_header_dicts(_raw_ask()))


# --- Tests -----------------------------------------------------------------


def test_the_rust_constants_are_parsed() -> None:
    # A regex that silently matched nothing would make every comparison vacuous.
    assert _rust_str("ENGINE_CLAUDE_USER_AGENT").startswith("claude-cli/")
    assert len(_rust_str_array("ENGINE_ANTHROPIC_BETAS")) >= 5
    assert _rust_str_array("ENGINE_ANTHROPIC_BETAS")[0] == "claude-code-20250219"
    assert len(_rust_pairs("ENGINE_ANTHROPIC_HEADERS")) >= 2
    assert ("x-app", "cli") in _rust_pairs("ENGINE_CLAUDE_CODE_HEADERS")
    assert _rust_struct_fields("ClaudeCodeUserId")


def test_the_engine_sends_each_session_class_its_native_ua() -> None:
    # Galley never sets `user_agent`, so every engine session starts on
    # `default_ua`, which NativeClaudeSession.__init__ (and so the
    # NativeOAISession that inherits it) swaps for the class's `native_ua`.
    # If this mechanism changes, the user agents below are the wrong ones.
    base_init = _statements(_function("__init__", _class("BaseSession").body))
    assert any(re.fullmatch(r"self\.default_ua = '[^']*'", s) for s in base_init)
    assert "self.user_agent = cfg.get('user_agent', self.default_ua)" in base_init
    native_init = _statements(_function("__init__", _class("NativeClaudeSession").body))
    swap = "if self.user_agent == self.default_ua:\n    self.user_agent = self.native_ua"
    assert swap in native_init, (
        "NativeClaudeSession.__init__ no longer swaps default_ua for native_ua: "
        "check which user agent the engine sends now, then "
        + _fix("ENGINE_CLAUDE_USER_AGENT and ENGINE_OPENAI_USER_AGENT")
    )
    oai = _class("NativeOAISession")
    assert [ast.unparse(b) for b in oai.bases] == ["NativeClaudeSession"]
    assert not any(isinstance(n, ast.FunctionDef) and n.name == "__init__" for n in oai.body)
    assert "headers['User-Agent'] = sess.user_agent" in _statements(_function("_openai_stream"))


def test_anthropic_user_agent_matches_the_engine() -> None:
    engine = _class_str("NativeClaudeSession", "native_ua")
    assert _rust_str("ENGINE_CLAUDE_USER_AGENT") == engine, _fix("ENGINE_CLAUDE_USER_AGENT")


def test_openai_user_agent_matches_the_engine() -> None:
    engine = _class_str("NativeOAISession", "native_ua")
    assert _rust_str("ENGINE_OPENAI_USER_AGENT") == engine, _fix("ENGINE_OPENAI_USER_AGENT")


def test_without_claude_code_identity_both_send_galleys_own_user_agent() -> None:
    # Managed patch 0032 (amended 2026-11-17): Galley's own user agent, the
    # one Sign in with ChatGPT sends: the engine's `_chatgpt_plan_user_agent()`
    # (patch 0007), Core's `chatgpt_siwc::galley_user_agent()`.
    headers = _assigned(_raw_ask(), "headers")
    assert isinstance(headers, ast.Dict)
    values = {
        k.value: v
        for k, v in zip(headers.keys, headers.values, strict=True)
        if isinstance(k, ast.Constant)
    }
    assert "_chatgpt_plan_user_agent()" in ast.unparse(values["user-agent"])
    plan_ua = _function("_chatgpt_plan_user_agent")
    assert "return f'Galley ({platform.system()}; {platform.machine()})'" in _statements(plan_ua)
    assert '.header("user-agent", chatgpt_siwc::galley_user_agent())' in _RUST


def test_anthropic_betas_match_the_engine_in_order() -> None:
    value = _assigned(_raw_ask(), "beta_parts")
    assert isinstance(value, ast.List)
    engine = [e.value for e in value.elts if isinstance(e, ast.Constant)]
    assert len(engine) == len(value.elts), "beta_parts is no longer a list of literals"
    assert _rust_str_array("ENGINE_ANTHROPIC_BETAS") == engine, _fix("ENGINE_ANTHROPIC_BETAS")
    # 0032 drops Claude Code's own beta by name.
    assert _rust_str("CLAUDE_CODE_BETA") in engine, _fix("CLAUDE_CODE_BETA")


def test_a_1m_model_is_handled_as_the_engine_handles_it() -> None:
    raw_ask = _raw_ask()
    inserts = [
        node
        for node in ast.walk(raw_ask)
        if isinstance(node, ast.Call) and ast.unparse(node.func) == "beta_parts.insert"
    ]
    assert len(inserts) == 1, "raw_ask: one beta_parts.insert(...) expected"
    at, beta = (a.value for a in inserts[0].args if isinstance(a, ast.Constant))
    assert _rust_usize("ENGINE_CONTEXT_1M_BETA_AT") == at, _fix("ENGINE_CONTEXT_1M_BETA_AT")
    assert _rust_str("ENGINE_CONTEXT_1M_BETA") == beta, _fix("ENGINE_CONTEXT_1M_BETA")

    [branch] = [
        node
        for node in ast.walk(raw_ask)
        if isinstance(node, ast.If) and any(inserts[0] in ast.walk(s) for s in node.body)
    ]
    marker = _rust_str("ENGINE_CONTEXT_1M_MARKER")
    assert ast.unparse(branch.test) == f"{marker!r} in model.lower()", (
        f"raw_ask's [1m] test changed: {ast.unparse(branch.test)}; "
        + _fix("ENGINE_CONTEXT_1M_MARKER and split_context_1m")
    )
    strip = f"model = model.replace({marker!r}, '').replace({marker.upper()!r}, '')"
    assert strip in {ast.unparse(s) for s in ast.walk(branch) if isinstance(s, ast.stmt)}, (
        "raw_ask no longer strips the marker as split_context_1m does; " + _fix("split_context_1m")
    )


def test_anthropic_fixed_headers_match_the_engine() -> None:
    headers = _claude_headers()
    always = headers.static_pairs(headers.names(identity_only=False))
    # reqwest's `.json()` sets it.
    assert always.pop("Content-Type") == "application/json"
    assert dict(_rust_pairs("ENGINE_ANTHROPIC_HEADERS")) == always, _fix("ENGINE_ANTHROPIC_HEADERS")


def test_claude_code_headers_match_the_engine() -> None:
    headers = _claude_headers()
    identity_only = headers.static_pairs(headers.names(identity_only=True))
    assert dict(_rust_pairs("ENGINE_CLAUDE_CODE_HEADERS")) == identity_only, _fix(
        "ENGINE_CLAUDE_CODE_HEADERS"
    )
    assert any(name.startswith("X-Stainless-") for name in identity_only)


def test_the_engine_sends_no_header_the_probe_does_not_know() -> None:
    headers = _claude_headers()
    # Headers whose value is computed: the probe builds these itself.
    assert headers.dynamic & headers.names(identity_only=False) == {
        "anthropic-beta",
        "user-agent",
    }, "raw_ask sends a new computed header on every request; mirror it in apply_probe_headers"
    assert headers.dynamic & headers.names(identity_only=True) == {
        _rust_str("ENGINE_CLAUDE_CODE_SESSION_HEADER")
    }, _fix("ENGINE_CLAUDE_CODE_SESSION_HEADER (or mirror the new header)")
    only_without = {name for name, where in headers.where.items() if where == {_NO_IDENTITY}}
    assert not only_without, f"raw_ask sends {only_without} only without Claude Code identity"


def test_claude_code_metadata_user_id_matches_the_engine() -> None:
    dumps = [
        node
        for node in ast.walk(_raw_ask())
        if isinstance(node, ast.Call)
        and ast.unparse(node.func) == "json.dumps"
        and node.args
        and isinstance(node.args[0], ast.Dict)
    ]
    assert len(dumps) == 1, "raw_ask: one json.dumps({...}) for metadata.user_id expected"
    user_id = dumps[0].args[0]
    assert isinstance(user_id, ast.Dict)
    keys = [k.value for k in user_id.keys if isinstance(k, ast.Constant)]
    assert _rust_struct_fields("ClaudeCodeUserId") == keys, _fix("struct ClaudeCodeUserId")
    values = dict(zip(keys, (ast.unparse(v) for v in user_id.values), strict=True))
    assert values == {
        "device_id": "self._device_id",
        "account_uuid": "''",
        "session_id": "self._session_id",
    }, _fix("ClaudeCodeIdentity::user_id")
    assert ast.unparse(dumps[0]).endswith("separators=(',', ':'))")
    init = _statements(_function("__init__", _class("NativeClaudeSession").body))
    assert "self._session_id = str(uuid.uuid4())" in init, _fix("ClaudeCodeIdentity::for_probe")
    assert "self._device_id = uuid.uuid4().hex + uuid.uuid4().hex[:32]" in init, _fix(
        "ClaudeCodeIdentity::for_probe"
    )


def test_openai_originator_matches_the_engine() -> None:
    headers = _Headers([_assigned(_function("_openai_stream"), "headers")])
    static = headers.static_pairs(headers.names(identity_only=False))
    assert static.pop("Content-Type") == "application/json"
    # The engine streams and the probe does not: not mirrored, on purpose.
    assert static.pop("Accept") == "text/event-stream"
    assert static == {"originator": _rust_str("ENGINE_OPENAI_ORIGINATOR")}, _fix(
        "ENGINE_OPENAI_ORIGINATOR (or mirror the new header)"
    )


@pytest.mark.parametrize(
    "constant",
    [
        "ENGINE_CLAUDE_USER_AGENT",
        "ENGINE_OPENAI_USER_AGENT",
        "ENGINE_OPENAI_ORIGINATOR",
        "ENGINE_CONTEXT_1M_MARKER",
        "ENGINE_CONTEXT_1M_BETA",
        "ENGINE_CLAUDE_CODE_SESSION_HEADER",
    ],
)
def test_each_mirrored_constant_is_used(constant: str) -> None:
    # A constant the probe no longer reads would pass the comparisons above
    # while the probe sends something else.
    assert len(re.findall(rf"\b{constant}\b", _RUST)) >= 2, f"{constant} is never used"
