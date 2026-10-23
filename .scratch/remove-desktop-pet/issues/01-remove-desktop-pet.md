# 01 删掉桌面宠物与重新注入工具：runner、Core、GUI、文档

Status: needs-dogfood（2026-10-23 机器验收过、合入 main；等 JC 真机看两个标题菜单与侧栏）

来源：[PRD](../PRD.md) 裁决 1、2（2026-10-23；JC：「按你推荐推进，删掉桌面宠物」「按建议推进」）。标题菜单里两个从上游搬来的项一起删。

## 为什么

桌面宠物是 05-13 从上游 GA 搬来的功能：标题菜单「桌面宠物」→ 桥起上游的 `frontends/desktop_pet_v2.pyw` 子进程，注册 `galley_pet_<sessionId>` 的 turn_end 钩子，每一步往 `127.0.0.1:41983` 推进展。现在两头都断了：内置运行时里宠物进程一起来就退出（macOS 缺 PyObjC，Windows 缺 tkinter），桥却照发「已附着」，侧栏挂着小猫徽标；外置下打得开，但上游 08-10 起拆了 HTTP 端口换成 hub 总线，推的进展全部落空。JC 定整条删掉。

「重新注入工具」也是 05-13 从上游搬来的：读上游的 `assets/tool_usable_history.json`、清 GA 的 `last_tools`、把文件内容追加进 `backend.history`。这个文件 06-23 起就不在内置代码里了，点了只报「GA asset not found」；引擎自己会在五种情况下自动重发完整工具说明。JC 定一并删掉。理由全文见 PRD 裁决 1、2。

## 要做的

先 `grep` 盘点，再删。下面是主会话盘到的位置（2026-10-23，按精确名字 `desktop_pet|DesktopPet|desktopPet|attach_pet|detach_pet|pet_attached|pet_detached|AttachPet|DetachPet|PetAttached|PetDetached|petSession|_pet_|galley_pet|桌面宠物|desktop pet|\bpet\b`），以你自己的 `grep` 为准，漏了的一并删：

1. **runner**：`runner/ipc.py`（`AttachPetCommand`、`DetachPetCommand`、`PetAttachedEvent`、`PetDetachedEvent`，以及它们在联合类型与 kind 映射里的条目）；`runner/workbench_bridge.py`（`_handle_attach_pet`、`_handle_detach_pet`、`_pet_process` / `_pet_port`、命令分发、关闭与看门狗里清理宠物子进程的那几处）；`runner/_watchdog.py`、`runner/ga_session.py` 里提到宠物的注释或代码；对应测试 `runner/tests/test_ipc.py`、`test_workbench_bridge.py`、`test_ga_session.py`、`test_watchdog.py`。清理子进程的通用机制若还服务别的子进程就留着，只删宠物那一项。
2. **Core**：`core/src/ipc.rs`（`PetAttached` / `PetDetached` 事件、`AttachPet` / `DetachPet` 命令、对应结构体与 `session_id` 的匹配分支）。`grep` 一遍 `core/` 与 `cli/` 确认没有别的读者（主会话盘到只有 `ipc.rs`）。
3. **GUI**：`gui/src/types/ipc.ts`（IPC 的 TS 镜像）、`gui/src/lib/ipc-handlers.ts`、`gui/src/stores/ui.ts`、`gui/src/stores/runtime.ts`、`gui/src/stores/runtime/info-slice.ts`、`gui/src/App.tsx`、`gui/src/components/layout/MainHeader.tsx`、`MainHeaderHost.tsx`、`header/SessionTitleMenu.tsx`（菜单项「桌面宠物」/「关闭桌面宠物」）、`Sidebar.tsx`、`sidebar/SidebarSessionRow.tsx`、`sidebar/SidebarTimelineRow.tsx`（小猫徽标与「桌面宠物附着中」提示）、`gui/src/lib/main-chat-reset.ts`、`assistant/AssistantIdentity.tsx` 的注释（菜单里那串「重新注入工具、桌面宠物」）、`gui/src/i18n/locales/zh.ts` / `en.ts` 的相关键；测试 `MainHeader.identity.test.tsx`、`MainHeaderHost.menu.test.tsx`、`main-chat-reset.test.ts` 跟着改。删完标题菜单里「重新注入工具」之后若留下多余的分隔线，去掉。
4. **重新注入工具**（PRD 裁决 2），盘点 `reinject|Reinject|tools_reinjected|ToolsReinjected|clear_last_tools|extend_history|tool_usable_history|重新注入`：
   - runner：`runner/ipc.py` 的 `ReinjectToolsCommand`、`ToolsReinjectedEvent` 与联合类型、kind 映射里的条目；`runner/workbench_bridge.py` 的 `_handle_reinject_tools` 与命令分发；`runner/ga_session.py` 的 `extend_history`、`clear_last_tools`（`grep` 确认只有重新注入在用，有别的读者就留着），以及模块文档串里耦合点清单的对应几行；测试 `test_ipc.py`、`test_ga_session.py` 跟着改。
   - Core：`core/src/ipc.rs` 对应的命令与事件。
   - GUI：`gui/src/types/ipc.ts`、`gui/src/lib/ipc-handlers.ts`、`MainHeader.tsx`、`MainHeaderHost.tsx`、`header/SessionTitleMenu.tsx`、`assistant/AssistantIdentity.tsx` 的注释、`zh.ts` / `en.ts` 的相关键（含成功 / 失败提示）；测试 `MainHeader.identity.test.tsx`、`MainHeaderHost.menu.test.tsx`。
   - 文档：`docs/ipc-protocol.md` 的 `reinject_tools` / `tools_reinjected` 条目与流程说明（约第 428、652 行）；`docs/ga-baseline.md` 的耦合点第 10 条与约第 778 行提到它的那句（照该文档写法，标明 2026-10-23 起 Galley 不再读这个文件）。
   - **两项都删后的标题菜单**：主对话是「查找聊天记录… ⌘F」、分隔线、「重置主对话…」；普通会话是「查找聊天记录… ⌘F」「重命名」，不留多余的分隔线。`docs/design/layout-and-chrome.md` 里那张两栏示意图照这个改。
5. **文档**：
   - `docs/ipc-protocol.md`：删掉两条命令、两条事件的条目；若文档有变更记录一节，记一行 2026-10-23 删除。
   - `docs/design/layout-and-chrome.md`：标题菜单的条目与示意（约第 58、67–68 行）、§「Desktop Pet」那条（约第 347 行）。
   - `docs/ga-baseline.md`：宠物的耦合点（`desktop_pet_v2.pyw`）那条，改成「2026-10-23 起 Galley 不再启动它」或删掉，照该文档的写法。
   - `managed-ga/patches/manifest.md`：`0020` 那行说 runner 侧兄弟进程（git probe、galley CLI、desktop pet）在 `runner/process_command.py` 里修，去掉「desktop pet」。只改说明文字，补丁本身不动。
   - 新写 `docs/devlog/2026-10-23-remove-desktop-pet-and-reinject-tools.md`（中文，全角标点）：两项各自为什么删（PRD 裁决 1 第 1、2 条与裁决 2 第 1–3 条，简述并链接 PRD）、删了什么、什么留着（上游文件、外置用户可自己运行上游宠物脚本）、删后的标题菜单；在 `docs/devlog/README.md` 的索引里加一行，照现有格式。旧 devlog 不改（那是历史）。

## 别动

- `managed-ga/code/` 下上游的宠物文件（`frontends/desktop_pet_v2.pyw`、皮肤、`DESKTOP_PET_README.md`）与 `stapp.py`、`ga_cli` 里上游自己的宠物用法：上游代码，不打补丁。
- CLI、Agent API、`docs/agent-api/`。上游 `stapp.py` / `stapp2.py` 里上游自己的「重新注入」按钮。
- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- `core/` 不是 rustfmt-clean：只用 `rustfmt --check` 核你改过的文件，别跑 `cargo fmt --all`。`gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add <文件…>` / `git rm <文件…>` 后 `git commit`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- 两串盘点 `grep`（宠物那串与第 4 条那串）在 `core/ cli/ runner/ gui/src docs/ipc-protocol.md docs/design docs/ga-baseline.md` 里为空（旧 devlog、`managed-ga/code/` 上游文件除外）
- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`CI=true pnpm --dir gui test`
- runner：在 worktree 根目录用主树的 venv 跑 `<主树>/.venv/bin/python -m pytest`（先打印 `runner.__file__` 确认指向 worktree）、`<主树>/.venv/bin/python -m mypy runner`、`<主树>/.venv/bin/ruff check runner`
- 门禁脚本（CI 前置门禁那六个）：`node scripts/check-ipc-protocol-drift.mjs`、`check-supervisor-sop-drift.mjs`、`check-docs-links.mjs`、`check-version-consistency.mjs`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs`
- 改过的 Rust 文件 `rustfmt --check`；`git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 删掉的文件与符号清单（按 runner / Core / GUI / 文档）；盘点 `grep` 删前删后的结果。
3. 看门狗与关闭流程里清理子进程那几处、`ga_session.py` 删掉的方法的 diff 原样。
4. 标题菜单删项后的样子（菜单项列表，前后对比）。
5. 每条验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方。

## Comments

### 2026-10-23 实施回报（worktree `genericagent-webui-wt-upstream-menu`，分支 `remove-pet-and-reinject`，基于 main `188be15c`）

#### 1. 提交列表

```
e70b9863 Docs: retire the desktop pet and Reinject Tools; devlog
914cb3af Remove the desktop pet and Reinject Tools across runner, Core and GUI
```

另加本回报一个提交（`git log --oneline main..HEAD` 全文见主会话回报）。不 push、不合入。

#### 2. 删掉的文件与符号

没有删整个文件，都是文件内删减（36 个文件，+135 / −1215）。

**runner**

- `runner/ipc.py`：`ToolsReinjectedEvent`、`PetAttachedEvent`、`PetDetachedEvent`、`ReinjectToolsCommand`、`AttachPetCommand`、`DetachPetCommand`，以及 `Event` / `Command` 联合类型、`EVENT_KINDS` / `COMMAND_KINDS` 里的六个条目。
- `runner/workbench_bridge.py`：`_handle_reinject_tools`、`_handle_attach_pet`、`_handle_detach_pet`、`_pet_process` / `_pet_port`、`dispatch_command` 的三个分支、`ShutdownCommand` 分支与 `run()` 主循环退出后的宠物清理、模块级 `_PARENT_LOSS_CLEANUP` 与 `__init__` 里往它注册的那一行、`main()` 传给看门狗的 `cleanup=`；六个 import。
- `runner/_watchdog.py`：`exit_parentless` 与 `start_parent_watchdog` 的 `cleanup` 参数、模块文档串里那条说明。理由：票面写「通用机制若还服务别的子进程就留着」——`_PARENT_LOSS_CLEANUP` 只装过宠物这一项，IM supervisor 与 browser bridge 调看门狗时都不传 `cleanup`，删宠物后它没有任何调用方。
- `runner/ga_session.py`：`extend_history`、`clear_last_tools`（`grep` 确认只有重新注入在用），以及删完后在 runner 里再无调用方的 `history()`（只被重新注入调用）、`unregister_turn_hook()`（只被解除宠物调用）——这两个票面没点名，按同一条规则一并删；模块文档串耦合点清单与 turn-end hooks 注释跟着改。
- 测试：`test_ipc.py` 删六个往返测试、小节标题改名；`test_workbench_bridge.py` 删 `test_run_loop_exit_detaches_pet`、`test_bridge_registers_parent_loss_pet_cleanup`，`test_shutdown_detaches_pet_and_sets_shutdown_event` 改成 `test_shutdown_sets_shutdown_event`，去掉一处 `_handle_detach_pet` 桩；`test_ga_session.py` 删 `unregister` / `history+extend` / `clear_last_tools` 三个测试，`preserves_other_writers` 改用上游键；`test_watchdog.py` 的清理测试改成 `test_exit_parentless_hard_exits_with_zero`。

**Core**

- `core/src/ipc.rs`：`IpcEvent::{ToolsReinjected, PetAttached, PetDetached}` 与 `session_id()` 的三个分支、三个事件结构体、`IpcCommand::{ReinjectTools, AttachPet, DetachPet}`、`AttachPetCommand`、测试 `attach_pet_wire_uses_port_not_variant`；`GenerateTitleCommand` 与其测试的注释原本引用 AttachPet 的约定，改成直接写理由。`grep` 过 `core/`、`cli/`，没有别的读者。

**GUI**

- `gui/src/types/ipc.ts`：三个事件、三个命令接口与联合类型条目。
- `gui/src/lib/ipc-handlers.ts`：`tools_reinjected`、`pet_attached`、`pet_detached` 三个分支（含隐式迁移重发 `attach_pet`），随之不用的 `makeAppError` import。
- `gui/src/stores/runtime/info-slice.ts`：`petAttachedSessionId`、`setPetAttachedSession`；`gui/src/stores/runtime.ts` 注释。
- `gui/src/stores/ui.ts`：`pendingPetMigrationTo`、`setPendingPetMigration`。
- `gui/src/App.tsx`、`Sidebar.tsx`、`sidebar/SidebarTimelineRow.tsx`、`sidebar/SidebarSessionRow.tsx`：`petAttachedSessionId` / `petAttached` 一路传参与小猫徽标（`Cat` 图标、「桌面宠物附着中」提示）。
- `MainHeader.tsx`、`MainHeaderHost.tsx`、`header/SessionTitleMenu.tsx`：`onReinjectTools`、`onTogglePet`、`currentSessionHasPet`，两个菜单项与图标（`ArrowsClockwise`、`Cat`）；`MainHeaderHost` 随之不用的 `bridgeStatus`、`sendIPCCommand` 与三个 import。分隔线改成只在「重置主对话…」前、且前面有项时出现。
- `gui/src/lib/main-chat-reset.ts`：清宠物绑定与迁移目标的两步、`useRuntimeStore` import。
- `assistant/AssistantIdentity.tsx` 注释里的菜单项改成 `查找聊天记录, 重置主对话`。
- `zh.ts` / `en.ts` 各删 10 个键：`sidebar.desktopPetAttached`、`desktopPetAttachedTitle`，`topbar.reinjectTools`、`desktopPet`、`closeDesktopPet`，`toasts.toolsReinjected`、`toolsReinjectedMessage`、`petStarted`、`petStartedMessage`、`petClosed`。
- 测试：`MainHeaderHost.menu.test.tsx` 三个用例改成新菜单（外置运行时的用例加断言只剩「查找」）；`MainHeader.identity.test.tsx` 改传 `onFindInChat`，断言菜单里有「查找聊天记录…」、没有「重命名」；`main-chat-reset.test.ts` 去掉宠物三行。

**文档**

- `docs/ipc-protocol.md`：§4.13–4.15、§5.10–5.12 删掉条目，各留一行删除说明并保留编号（照 §4.3、§5.2 审批删除的写法；文档没有单独的变更记录一节）。
- `docs/design/layout-and-chrome.md`：标题菜单条目、主对话菜单那句、两栏示意图、「普通会话里它和重命名同组」那句、§侧栏的 Desktop Pet 徽标条。
- `docs/ga-baseline.md`：宠物脚本那句标「since 2026-10-23 Galley no longer launches it」；约 778 行那句标「since 2026-10-23 no longer reads that one either」；Contract Surface 第 9（`last_tools`）、10（`tool_usable_history.json`）条标为 2026-10-23 退役、编号保留（后文多处按编号引用）；「Where each coupling lives」里 `ga_session.py` 的条目号与描述更新，`_handle_reinject_tools` 那条删掉。
- `managed-ga/patches/manifest.md`：`0020` 那行去掉「desktop pet」，补丁本身不动。
- 票面清单外、`grep` 盘到的：`CONTEXT.md`「GA integration seam」一段（去掉 `last_tools` 与 `tool_usable_history.json` 耦合）；`docs/galley-native/rfc-1-runtime-boundary.md` 「current IpcEvent vocabulary」里的 `tools_reinjected`。
- 新写 `docs/devlog/2026-10-23-remove-desktop-pet-and-reinject-tools.md`，`docs/devlog/README.md` 时间线加 2026-10-23 一行。

**盘点 `grep`**（`core cli runner gui/src docs/ipc-protocol.md docs/design docs/ga-baseline.md`，用 `git grep -P` 分别对 `main` 与 `HEAD`）：

| 串 | 删前（main） | 删后（HEAD） |
|---|---|---|
| 宠物 | 251 行 / 28 个文件 | 6 行 / 3 个文件 |
| 重新注入 | 115 行 / 19 个文件 | 7 行 / 3 个文件 |

删后剩下的都在文档里，代码目录（`core cli runner gui/src`）为 0：

- 指向新 devlog 与 PRD 的链接路径（文件名本身含 `desktop-pet`、`reinject`）：`ipc-protocol.md:428`、`:601`，`layout-and-chrome.md:58`、`:69`，`ga-baseline.md:1063`。去掉链接目标后再 `grep`，只剩下面这三行。
- 票面要求「标明 2026-10-23 起不再读 / 不再启动」而保留文件名的三行：`ga-baseline.md:709`（`desktop_pet_v2.pyw`）、`:778`、`:1065`（`tool_usable_history.json`）。

#### 3. 清理子进程那几处、`ga_session.py` 删掉的方法（diff 原样）

`runner/_watchdog.py`（整份）：

```diff
@@ -11,10 +11,6 @@ Entrypoint-specific bits are parameters, not forks:

 - ``label``       — process tag in the exit log line.
 - ``thread_name`` — the watchdog thread's name.
-- ``cleanup``     — best-effort hooks run before the hard exit (e.g. the
-                    workbench bridge tears down its desktop-pet child). The
-                    iterable is read at exit time, so a live list that other
-                    code appends to after the watchdog starts is honored.
 """
 from __future__ import annotations

@@ -22,7 +18,6 @@ import os
 import sys
 import threading
 import time
-from collections.abc import Callable, Iterable

 GALLEY_CORE_PID_ENV = "GALLEY_CORE_PID"
 PARENT_WATCH_INTERVAL_SEC = 2.0
@@ -93,17 +88,11 @@ def exit_parentless(
     reason: str,
     *,
     label: str,
-    cleanup: Iterable[Callable[[], None]] = (),
 ) -> None:
     try:
         print(f"[{label}] exiting: {reason}", file=sys.__stderr__, flush=True)
     except Exception:
         pass
-    for hook in list(cleanup):
-        try:
-            hook()
-        except Exception:
-            pass
     _EXIT_FOR_PARENT_LOSS(0)
     raise SystemExit(0)

@@ -113,7 +102,6 @@ def start_parent_watchdog(
     *,
     label: str,
     thread_name: str,
-    cleanup: Iterable[Callable[[], None]] = (),
 ) -> None:
     if parent_pid is None:
         return
@@ -124,6 +112,6 @@ def start_parent_watchdog(
             time.sleep(PARENT_WATCH_INTERVAL_SEC)
             reason = parent_loss_reason(parent_pid, original_ppid)
             if reason:
-                exit_parentless(reason, label=label, cleanup=cleanup)
+                exit_parentless(reason, label=label)

     threading.Thread(target=_watch, name=thread_name, daemon=True).start()
```

`runner/workbench_bridge.py`（只摘清理那几处的 hunk：父进程丢失清理表、`__init__` 注册、`shutdown` 分支、主循环退出、`main()` 传看门狗；三个处理函数整段删除的 hunk 略）：

```diff
@@ -319,14 +313,6 @@ _managed_model_config_from_env = managed_runtime.managed_model_config_from_env
 _USAGE_FIELDS = ("requests", "input", "output", "cache_create", "cache_read")


-# Best-effort cleanup hooks run before the parent-loss hard exit (see
-# runner/_watchdog.py). os._exit skips finally blocks and atexit handlers,
-# so child processes (the desktop pet) must be torn down explicitly or they
-# leak. Passed to the watchdog as its `cleanup` iterable; read at exit time
-# so pet-attach appends after the watchdog starts are still honored.
-_PARENT_LOSS_CLEANUP: list[Any] = []
-
-
 def _llm_display_name(raw: str) -> str:
     """Return the display name to send over Galley's IPC protocol.

@@ -689,11 +668,6 @@ class Bridge:
         # not close the newer run, nor pre-empt Abort's ABORTED (a user
         # stop must reach Core as ABORTED, e.g. `live.lastExit`).
         self._run_generation: int = 0
-        # The parent watchdog exits with os._exit, which skips finally
-        # blocks and atexit — an attached pet would survive as an orphan
-        # holding its fixed port (and Galley Core is already gone, so
-        # nothing else cleans it up). Register best-effort cleanup.
-        _PARENT_LOSS_CLEANUP.append(lambda: self._handle_detach_pet(silent=True))

     def _current_absolute_turn_index(self, turn_index: int) -> int | None:
         if self._current_message_turn_base is None:
@@ -1791,17 +1765,9 @@ class Bridge:
             self._handle_set_llm(cmd)
         elif isinstance(cmd, SetReasoningEffortCommand):
             self._handle_set_reasoning_effort(cmd)
-        elif isinstance(cmd, ReinjectToolsCommand):
-            self._handle_reinject_tools()
-        elif isinstance(cmd, AttachPetCommand):
-            self._handle_attach_pet(cmd)
-        elif isinstance(cmd, DetachPetCommand):
-            self._handle_detach_pet()
         elif isinstance(cmd, GenerateTitleCommand):
             self._handle_generate_title(cmd)
         elif isinstance(cmd, ShutdownCommand):
-            # Make sure pet subprocess + hook don't leak on shutdown.
-            self._handle_detach_pet(silent=True)
             self.shutdown_event.set()

     def _handle_set_llm(self, cmd: SetLLMCommand) -> None:
@@ -2245,12 +1993,6 @@ class Bridge:
                     f"command dispatch failed: {e}", traceback.format_exc()
                 )

-        # Whatever ended the loop (Shutdown command, stdin EOF, stdout
-        # write failure), the pet subprocess must not outlive the bridge —
-        # an orphan keeps holding its fixed port and blocks the next
-        # attach. Idempotent: the Shutdown command path already detached.
-        self._handle_detach_pet(silent=True)
-
         # Flush tail events deterministically: enqueue the writer-exit
         # sentinel and join with a bound. Everything queued before the
         # sentinel is written + flushed when join returns. (The previous
@@ -2320,7 +2062,6 @@ def main() -> int:
         _watchdog.parse_core_pid(),
         label="workbench-bridge",
         thread_name="galley-bridge-parent-watchdog",
-        cleanup=_PARENT_LOSS_CLEANUP,
     )

     ga_path = str(Path(args.ga_path).expanduser().resolve())
```

`runner/ga_session.py`（整份）：

```diff
@@ -11,9 +11,8 @@ Scope rule (2026-07-11 decision): GaSession wraps exactly the
 *internal / underscore / backend* surface — the things a baseline
 upgrade can silently move:

-- ``agent._turn_end_hooks``       → register/unregister_turn_hook
-- ``agent.llmclient.backend.history`` → history / set_history /
-                                        extend_history / context_usage
+- ``agent._turn_end_hooks``       → register_turn_hook
+- ``agent.llmclient.backend.history`` → set_history / context_usage
 - ``agent.llmclient.backend.raw_ask`` → side_ask (read-only one-shot,
                                         no history write)
 - ``agent.llmclient.backend.reasoning_effort`` → active_backend_id /
@@ -22,7 +21,6 @@ upgrade can silently move:
                                         override, same in-process write
                                         as upstream's
                                         ``/session.reasoning_effort=``)
-- ``agent.llmclient.last_tools``  → clear_last_tools
 - ``agent._ga_project_mode_*``    → set_project_mode (Galley-namespaced,
                                     in-memory only per Rule 1)
 - ``agentmain.GenericAgentHandler`` module binding → install_handler
@@ -143,35 +141,16 @@ class GaSession:

     # ---------------- turn-end hooks ----------------
     # GA's agent_runner_loop calls each registered hook after every
-    # loop step. The dict lives on the agent object; both Galley
-    # consumers (workbench turn streaming, desktop pet) register here.
+    # loop step. The dict lives on the agent object; Galley's consumer
+    # (workbench turn streaming) registers here.

     def register_turn_hook(self, key: str, fn: Callable[..., Any]) -> None:
         if not hasattr(self.agent, "_turn_end_hooks"):
             self.agent._turn_end_hooks = {}
         self.agent._turn_end_hooks[key] = fn

-    def unregister_turn_hook(self, key: str) -> None:
-        """Best-effort removal — safe on agents that never had hooks."""
-        try:
-            hooks = getattr(self.agent, "_turn_end_hooks", None)
-            if isinstance(hooks, dict):
-                hooks.pop(key, None)
-        except Exception:
-            pass
-
     # ---------------- backend history ----------------

-    def history(self) -> list[Any]:
-        """The live backend history list. Raises AttributeError-family
-        errors when the backend isn't shaped as expected — callers own
-        the error narration (their messages are user-facing)."""
-        result: list[Any] = self.agent.llmclient.backend.history
-        return result
-
-    def extend_history(self, blocks: list[Any]) -> None:
-        self.history().extend(blocks)
-
     def set_history(self, messages: list[dict[str, Any]]) -> str | None:
         """Replace backend history with desktop-shape ``messages``
         adapted to GA's native block format.
@@ -356,15 +335,6 @@ class GaSession:
                 return "".join(texts)
         return text

-    def clear_last_tools(self) -> None:
-        """Reset GA's per-LLM "last seen tools" cache so the next prompt
-        rebuilds the tool block from scratch (mirrors stapp.py). Older
-        GA versions lack the attribute — non-fatal by design."""
-        try:
-            self.agent.llmclient.last_tools = ""
-        except Exception:
-            pass
-
     def context_usage(self) -> dict[str, int]:
         """Estimate backend context usage without mutating runtime state.

```

#### 4. 标题菜单前后对比

| | 删前 | 删后 |
|---|---|---|
| 主对话（内置运行时） | 查找聊天记录… ⌘F、─、重新注入工具、桌面宠物（本会话持有时为「关闭桌面宠物」）、─、重置主对话… | 查找聊天记录… ⌘F、─、重置主对话… |
| 普通会话 | 查找聊天记录… ⌘F、重命名、─、重新注入工具、桌面宠物 | 查找聊天记录… ⌘F、重命名 |
| 主对话在外置运行时（测试用例，实际外置没有主对话） | 查找聊天记录… ⌘F、─、重新注入工具、桌面宠物 | 查找聊天记录… ⌘F |

由 `MainHeaderHost.menu.test.tsx` 的三个用例按顺序断言（分隔线记作「─」）。

#### 5. 验证

在最终状态（`HEAD e70b9863`）上一次跑完，命令与输出摘录原样（日志尾部）：

```
=== cargo check --manifest-path core/Cargo.toml --workspace ===
warning: `galley-relay` (lib) generated 1 warning (run `cargo fix --lib -p galley-relay` to apply 1 suggestion)
    Checking galley-cli v0.7.0 (…/genericagent-webui-wt-upstream-menu/cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 21.86s
exit=0
=== cargo test --manifest-path core/Cargo.toml --workspace ===
exit=0
test result lines: 45 passed: 1220 failed: 0
=== pnpm --dir gui typecheck ===
> tsc --noEmit
exit=0
=== pnpm --dir gui lint ===
> eslint src --max-warnings 0
exit=0
=== CI=true pnpm --dir gui test ===
 Test Files  205 passed (205)
      Tests  2263 passed (2263)
exit=0
=== runner.__file__ ===
…/genericagent-webui-wt-upstream-menu/runner/__init__.py
=== <主树>/.venv/bin/python -m pytest -q ===
====================== 628 passed, 6 deselected in 8.41s =======================
exit=0
=== <主树>/.venv/bin/python -m mypy runner ===
Success: no issues found in 34 source files
exit=0
=== <主树>/.venv/bin/ruff check runner ===
All checks passed!
exit=0
=== node scripts/check-ipc-protocol-drift.mjs ===
[ipc-drift] IPC protocol fields and optional/null semantics aligned (python: 15 events, 8 commands; rust: 15 events, 8 commands; ts: 15 events, 8 commands)
exit=0
=== node scripts/check-supervisor-sop-drift.mjs ===
[supervisor-sop-drift] 4 reference copies verbatim with canonical docs; SKILL.md variants aligned
exit=0
=== node scripts/check-docs-links.mjs ===
docs link gate OK: 474 files checked.
exit=0
=== node scripts/check-version-consistency.mjs ===
[version-consistency] 5 files agree on 0.7.0
exit=0
=== node scripts/check-managed-ga-payload.mjs ===
[managed-ga-payload] OK
exit=0
=== node scripts/check-ga-baseline-drift.mjs ===
[ga-baseline-drift] OK (b70079dc)
exit=0
=== rustfmt --check --edition 2021 core/src/ipc.rs ===
exit=0
=== git diff --check main..HEAD ===
exit=0
```

- `cargo test` 一行是对 45 条 `test result` 行的求和（全部 `ok`），完整日志在 scratchpad。
- runner 628 = 删前 640 − 本票删掉的 12 个测试（`test_ipc.py` 7、`test_workbench_bridge.py` 2、`test_ga_session.py` 3）。
- 唯一改过的 Rust 文件是 `core/src/ipc.rs`。GUI 改过的旧文件里，`App.tsx`、`SidebarSessionRow.tsx`、`zh.ts`、`en.ts`、`ipc-handlers.ts` 在 main 上本来就不 prettier-clean：逐个比了 prettier 偏差行数，删后与删前相同（`ipc-handlers.ts` 少一行，删掉了一处多余空行），其余改过的文件删前删后都 clean。
- 新增与改动的中文文档行用 scratchpad 正则扫过半角标点：只命中 devlog 头的 `Status:`，那是现有 devlog 的英文键写法，保留。

#### 6. 看到但没改的、没验证到的

- **没验证到**：没跑 `tauri dev` 真机（派单禁止），菜单与侧栏的视觉只有静态渲染测试覆盖，待 JC 真机验收；runner e2e（要真 GA + LLM）没跑；Windows 未测（改动不涉平台分支）。
- **超出票面字面的删除**，请主会话过目：`_watchdog.py` 的 `cleanup` 参数、`GaSession.history()` 与 `unregister_turn_hook()`（理由见第 2 条）；`CONTEXT.md` 与 Galley Native RFC 1 两处文档。
- **协议文档的写法**：票面写「删掉条目」，我照该文档 10-05 删审批时的写法留了编号与一行删除说明（不含旧名字），免得 §4.16 之后的编号引用错位。
- **盘点 `grep` 不为空**：见第 2 条末，都是链接路径与票面要求保留文件名的三行。
- 看到没改：`docs/audits/codebase-review-2026-07-02/README.md`、`docs/archive/**`、`.scratch/main-chat/**` 里提到宠物 / 重新注入的是历史记录；`scripts/seed-screenshots.py` 的「无宠物」是截图种子里的二手沙发文案，无关；`runner/tests/test_im_resume.py`、`test_managed_discord_dcapp.py` 的假 `llmclient` 带 `last_tools = ""`，模拟的是上游代码自己读的属性，与 `GaSession` 无关，留着。
- `cargo check` 有一条 `galley-relay` 的 `fetch_update` 弃用警告（`relay/src/channels.rs:347`），本票没碰 relay，早已存在。
- `docs/project-status.md` 的「Unreleased On Main」没写这一项，留给合入时的收尾。

### 2026-10-23 主会话验收

- 核过代理超出票面字面多删的几处：`_watchdog.py` 的 `cleanup` 只有 `workbench_bridge` 传过（浏览器桥、IM supervisor 调 `start_parent_watchdog` / `exit_parentless` 都不带它）；`GaSession.history()` 只有重新注入在调，`unregister_turn_hook()` 只有解除宠物在调（`git grep` main 上的调用方）。删得对。
- 门禁在最终状态上重跑：`cargo test --workspace` 45 组 1220 通过 0 失败；`rustfmt --check core/src/ipc.rs` 通过；runner `pytest` 628 通过（`runner.__file__` 指向 worktree）、`mypy` 与 `ruff` 干净；六个 `check-*.mjs` 门禁全过；`pnpm --dir gui typecheck`、`lint` exit 0，`CI=true pnpm --dir gui test` 205 文件 2263 测试全过；`git diff --check` 干净。
- 合入前 `galley status` 为 `busy: 0`。
