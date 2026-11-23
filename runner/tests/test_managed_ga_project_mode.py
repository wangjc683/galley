"""Managed-GA patch 0036: project mode names the folder the user chose.

A project bound to a folder gets a link at ``temp/projects/<name>-<hash>``
in the state root (``workspace_cmd.prepare``: a directory junction on
Windows, a symlink elsewhere). Upstream's per-round injection named only
that link ("项目私域目录"), so the model searched temp for "the working
directory" and reported link paths to the user (galley#34). With the patch,
when ``_ga_project_mode_workspace_path`` is set and the link is that folder,
the injection names the real folder, says it is what the user calls the
working / project folder, and says the link is not a copy. Otherwise (no
folder, a project entered by name, a missing link) the text is upstream's,
byte for byte: the expected strings below freeze the pre-0036 wording.

The plugin and ``workspace_cmd`` are loaded from the shipped payload under
private module names, with ``GALLEY_GA_STATE_ROOT`` (read at import) pointed
at a temp dir and a stub ``plugins.hooks``, so no other test's modules or
hook registry see them.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest

_MANAGED_GA_CODE = Path(__file__).resolve().parents[2] / "managed-ga" / "code"

# The pre-0036 injection, frozen. Without a bound folder the patch must not
# move a byte of it.
_UPSTREAM_INJECTION = (
    "\n\n---\n"
    "[PROJECT MODE: {name}]\n"
    "你正在「{name}」项目模式中。\n\n"
    "## 规则\n"
    "{dir_rule}"
    "- {mem_hint}\n\n"
    "## 收尾纪律\n"
    "干完本轮活后自问一个问题："
    "「记忆归零、重新接手本项目的我，"
    "缺了本轮哪条信息会重复付出认知代价"
    "——再踩一次坑、再摸索一次、"
    "再问一次用户？」会的，"
    "就用 file 工具把那条追加进 {mem_path}，"
    "写成未来的自己能直接复用的一句话；"
    "不会的，一个字都不写。\n"
    "---"
)
_UPSTREAM_DIR_RULE = "- 项目私域目录：{pdir}（todo、草稿、产物一律放这里，勿放 temp 根目录）\n"
_EMPTY_HINT = "项目记忆 {mem_path} 暂为空（本项目尚无沉淀），无需读取。"
_FULL_HINT = (
    "项目全量记忆在 {mem_path}（{lines} 行 / {nbytes} 字节）。"
    "本轮任务若涉及项目上下文（接续工作、查约定、避坑），"
    "先读它再动手；"
    "若与项目认知无关（闲聊、独立小事），可不读。"
    "自行判断。"
)
# Ticket 01 section 2.3, verbatim: these two lines replace the first rule.
_FOLDER_DIR_RULE = (
    "- 项目文件夹：{workspace}。"
    "这是用户为本项目选的文件夹，"
    "用户说的「工作目录」「项目文件夹」「项目目录」"
    "指的就是它："
    "用户提到的文件先在这里找；"
    "todo、草稿、产物一律放这里（勿放 temp 根目录）；"
    "对用户说路径时用这个路径。\n"
    "- {pdir} 是指向这个文件夹的链接，"
    "不是副本，不要清理或删除它。\n"
)


def _expected(name: str, mem_path: str, memory: str, dir_rule: str, **fields: str) -> str:
    if memory:
        hint = _FULL_HINT.format(
            mem_path=mem_path,
            lines=len(memory.splitlines()),
            nbytes=len(memory.encode("utf-8")),
        )
    else:
        hint = _EMPTY_HINT.format(mem_path=mem_path)
    return _UPSTREAM_INJECTION.format(
        name=name, dir_rule=dir_rule.format(**fields), mem_hint=hint, mem_path=mem_path
    )


def _upstream(name: str, pdir: str, memory: str) -> str:
    mem_path = os.path.join(pdir, "project_memory.md")
    return _expected(name, mem_path, memory, _UPSTREAM_DIR_RULE, pdir=pdir)


def _folder(name: str, pdir: str, workspace: str, memory: str) -> str:
    mem_path = os.path.join(workspace, "project_memory.md")
    return _expected(name, mem_path, memory, _FOLDER_DIR_RULE, workspace=workspace, pdir=pdir)


@dataclass
class _Payload:
    project_mode: Any
    workspace_cmd: Any
    state_root: Path
    registered: list[tuple[str, Any]]

    def projects_dir(self) -> Path:
        return self.state_root / "temp" / "projects"


def _load(module_name: str, rel_path: str) -> Any:
    spec = importlib.util.spec_from_file_location(module_name, _MANAGED_GA_CODE / rel_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def payload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> _Payload:
    state_root = tmp_path / "managed-ga-state"
    state_root.mkdir()
    monkeypatch.setenv("GALLEY_GA_STATE_ROOT", str(state_root))
    # Never write .pyc into the shipped payload (check-managed-ga-payload).
    monkeypatch.setattr(sys, "dont_write_bytecode", True)

    registered: list[tuple[str, Any]] = []

    def register(event: str) -> Any:
        def decorator(fn: Any) -> Any:
            registered.append((event, fn))
            return fn

        return decorator

    hooks = cast(Any, types.ModuleType("plugins.hooks"))
    hooks.register = register
    plugins = cast(Any, types.ModuleType("plugins"))
    plugins.__path__ = []
    plugins.hooks = hooks
    monkeypatch.setitem(sys.modules, "plugins", plugins)
    monkeypatch.setitem(sys.modules, "plugins.hooks", hooks)

    project_mode = _load("managed_ga_project_mode_under_test", "plugins/project_mode.py")
    workspace_cmd = _load("managed_ga_workspace_cmd_under_test", "frontends/workspace_cmd.py")
    return _Payload(project_mode, workspace_cmd, state_root, registered)


_UNSET = object()


def _run(payload: _Payload, name: str, workspace: object = _UNSET, content: Any = "hi") -> Any:
    parent = types.SimpleNamespace(_ga_project_mode_name=name)
    if workspace is not _UNSET:
        parent._ga_project_mode_workspace_path = workspace
    message = {"role": "user", "content": content}
    ctx = {
        "handler": types.SimpleNamespace(parent=parent),
        "messages": [{"role": "system", "content": "sys"}, message],
    }
    payload.project_mode.inject_project_context(ctx)
    return message["content"]


def _appended(payload: _Payload, name: str, workspace: object = _UNSET) -> str:
    content = _run(payload, name, workspace)
    assert isinstance(content, str)
    assert content.startswith("hi")
    return content[len("hi") :]


def _bind(payload: _Payload, folder: Path, memory: str = "") -> dict[str, Any]:
    folder.mkdir(parents=True)
    if memory:
        (folder / "project_memory.md").write_text(memory, encoding="utf-8", newline="")
    result: dict[str, Any] = payload.workspace_cmd.prepare(str(folder))
    assert result["ok"], result
    assert payload.workspace_cmd.is_dir_link(result["link"])
    return result


def test_the_hook_is_registered_on_agent_before(payload: _Payload) -> None:
    assert payload.registered == [("agent_before", payload.project_mode.inject_project_context)]


@pytest.mark.parametrize("memory", ["", "约定一\n约定二\n"], ids=["empty", "with-memory"])
@pytest.mark.parametrize("workspace", [_UNSET, None, ""], ids=["missing", "none", "empty"])
def test_without_a_folder_the_text_is_upstreams(
    payload: _Payload, workspace: object, memory: str
) -> None:
    # The SOP route: "进入某某项目" makes a real dir temp/projects/<name>.
    pdir = payload.projects_dir() / "demo"
    pdir.mkdir(parents=True)
    if memory:
        (pdir / "project_memory.md").write_text(memory, encoding="utf-8", newline="")

    text = _appended(payload, "demo", workspace)

    assert text == _upstream("demo", str(pdir), memory)
    assert f"- 项目私域目录：{pdir}（" in text
    assert "项目文件夹：" not in text


@pytest.mark.parametrize("memory", ["", "约定一\n约定二\n"], ids=["empty", "with-memory"])
@pytest.mark.parametrize("trailing_sep", [False, True], ids=["plain", "trailing-sep"])
def test_a_bound_folder_is_named_with_its_real_path(
    payload: _Payload, tmp_path: Path, memory: str, trailing_sep: bool
) -> None:
    folder = tmp_path / "work" / "demo"
    bound = _bind(payload, folder, memory)
    name, link, target = bound["name"], bound["link"], bound["target"]
    assert link == payload.project_mode._project_dir(name)
    attr = target + os.sep if trailing_sep else target

    text = _appended(payload, name, attr)

    assert text == _folder(name, link, os.path.abspath(target), memory)
    assert f"[PROJECT MODE: {name}]\n" in text
    assert f"你正在「{name}」项目模式中。" in text
    assert f"- 项目文件夹：{target}。" in text
    assert f"- {link} 是指向这个文件夹的链接，不是副本，不要清理或删除它。\n" in text
    mem_path = os.path.join(target, "project_memory.md")
    assert text.count(mem_path) == 2  # memory hint and 收尾纪律
    assert os.path.join(link, "project_memory.md") not in text
    assert "项目私域目录" not in text
    if memory:
        assert "（2 行 / " in text  # counted through the link, same file


def test_a_project_entered_by_name_keeps_upstreams_text(payload: _Payload, tmp_path: Path) -> None:
    bound = _bind(payload, tmp_path / "work" / "demo")
    # handler.enter_project_mode('other') renames; the folder attribute stays.
    other = payload.projects_dir() / "other"
    other.mkdir()

    text = _appended(payload, "other", bound["target"])

    assert text == _upstream("other", str(other), "")
    assert bound["target"] not in text


@pytest.mark.parametrize("breakage", ["link-removed", "folder-removed", "nul-in-path"])
def test_a_broken_binding_keeps_upstreams_text_without_raising(
    payload: _Payload, tmp_path: Path, breakage: str
) -> None:
    bound = _bind(payload, tmp_path / "work" / "demo")
    name, link, target = bound["name"], bound["link"], bound["target"]
    attr = target
    if breakage == "link-removed":
        assert payload.workspace_cmd.remove_dir_link(link)
        assert not os.path.lexists(link)
    elif breakage == "folder-removed":
        shutil.rmtree(target)  # the link dangles
    else:
        attr = target + "\x00"  # os.path.samefile raises ValueError

    text = _appended(payload, name, attr)

    assert text == _upstream(name, link, "")
    assert "项目文件夹：" not in text


@pytest.mark.parametrize("bound", [True, False], ids=["folder", "no-folder"])
def test_multimodal_content_gets_the_same_text(
    payload: _Payload, tmp_path: Path, bound: bool
) -> None:
    if bound:
        result = _bind(payload, tmp_path / "work" / "demo", "约定一\n")
        name, workspace = result["name"], result["target"]
    else:
        (payload.projects_dir() / "demo").mkdir(parents=True)
        name, workspace = "demo", None

    as_string = _appended(payload, name, workspace)
    image = {"type": "image", "source": {"type": "base64", "data": "AAAA"}}
    blocks = _run(payload, name, workspace, content=[{"type": "text", "text": "hi"}, image])

    assert blocks[:2] == [{"type": "text", "text": "hi"}, image]
    assert blocks[2:] == [{"type": "text", "text": as_string}]
