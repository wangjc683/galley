# 01 删掉桌面宠物：runner、Core、GUI、文档

Status: ready-for-agent（等主聊天票 91 合入 main 后派）

来源：[PRD](../PRD.md) 裁决 1（2026-10-23；JC：「按你推荐推进，删掉桌面宠物」）。

## 为什么

桌面宠物是 05-13 从上游 GA 搬来的功能：标题菜单「桌面宠物」→ 桥起上游的 `frontends/desktop_pet_v2.pyw` 子进程，注册 `galley_pet_<sessionId>` 的 turn_end 钩子，每一步往 `127.0.0.1:41983` 推进展。现在两头都断了：内置运行时里宠物进程一起来就退出（macOS 缺 PyObjC，Windows 缺 tkinter），桥却照发「已附着」，侧栏挂着小猫徽标；外置下打得开，但上游 08-10 起拆了 HTTP 端口换成 hub 总线，推的进展全部落空。JC 定整条删掉。理由全文见 PRD 裁决 1。

## 要做的

先 `grep` 盘点，再删。下面是主会话盘到的位置（2026-10-23，按精确名字 `desktop_pet|DesktopPet|desktopPet|attach_pet|detach_pet|pet_attached|pet_detached|AttachPet|DetachPet|PetAttached|PetDetached|petSession|_pet_|galley_pet|桌面宠物|desktop pet|\bpet\b`），以你自己的 `grep` 为准，漏了的一并删：

1. **runner**：`runner/ipc.py`（`AttachPetCommand`、`DetachPetCommand`、`PetAttachedEvent`、`PetDetachedEvent`，以及它们在联合类型与 kind 映射里的条目）；`runner/workbench_bridge.py`（`_handle_attach_pet`、`_handle_detach_pet`、`_pet_process` / `_pet_port`、命令分发、关闭与看门狗里清理宠物子进程的那几处）；`runner/_watchdog.py`、`runner/ga_session.py` 里提到宠物的注释或代码；对应测试 `runner/tests/test_ipc.py`、`test_workbench_bridge.py`、`test_ga_session.py`、`test_watchdog.py`。清理子进程的通用机制若还服务别的子进程就留着，只删宠物那一项。
2. **Core**：`core/src/ipc.rs`（`PetAttached` / `PetDetached` 事件、`AttachPet` / `DetachPet` 命令、对应结构体与 `session_id` 的匹配分支）。`grep` 一遍 `core/` 与 `cli/` 确认没有别的读者（主会话盘到只有 `ipc.rs`）。
3. **GUI**：`gui/src/types/ipc.ts`（IPC 的 TS 镜像）、`gui/src/lib/ipc-handlers.ts`、`gui/src/stores/ui.ts`、`gui/src/stores/runtime.ts`、`gui/src/stores/runtime/info-slice.ts`、`gui/src/App.tsx`、`gui/src/components/layout/MainHeader.tsx`、`MainHeaderHost.tsx`、`header/SessionTitleMenu.tsx`（菜单项「桌面宠物」/「关闭桌面宠物」）、`Sidebar.tsx`、`sidebar/SidebarSessionRow.tsx`、`sidebar/SidebarTimelineRow.tsx`（小猫徽标与「桌面宠物附着中」提示）、`gui/src/lib/main-chat-reset.ts`、`assistant/AssistantIdentity.tsx` 的注释（菜单里那串「重新注入工具、桌面宠物」）、`gui/src/i18n/locales/zh.ts` / `en.ts` 的相关键；测试 `MainHeader.identity.test.tsx`、`MainHeaderHost.menu.test.tsx`、`main-chat-reset.test.ts` 跟着改。删完标题菜单里「重新注入工具」之后若留下多余的分隔线，去掉。
4. **文档**：
   - `docs/ipc-protocol.md`：删掉两条命令、两条事件的条目；若文档有变更记录一节，记一行 2026-10-23 删除。
   - `docs/design/layout-and-chrome.md`：标题菜单的条目与示意（约第 58、67–68 行）、§「Desktop Pet」那条（约第 347 行）。
   - `docs/ga-baseline.md`：宠物的耦合点（`desktop_pet_v2.pyw`）那条，改成「2026-10-23 起 Galley 不再启动它」或删掉，照该文档的写法。
   - `managed-ga/patches/manifest.md`：`0020` 那行说 runner 侧兄弟进程（git probe、galley CLI、desktop pet）在 `runner/process_command.py` 里修，去掉「desktop pet」。只改说明文字，补丁本身不动。
   - 新写 `docs/devlog/2026-10-23-remove-desktop-pet.md`（中文，全角标点）：为什么删（PRD 裁决 1 第 1、2 条，简述并链接 PRD）、删了什么、什么留着（上游文件、外置用户可自己运行上游脚本）；在 `docs/devlog/README.md` 的索引里加一行，照现有格式。旧 devlog 不改（那是历史）。

## 别动

- `managed-ga/code/` 下上游的宠物文件（`frontends/desktop_pet_v2.pyw`、皮肤、`DESKTOP_PET_README.md`）与 `stapp.py`、`ga_cli` 里上游自己的宠物用法：上游代码，不打补丁。
- 「重新注入工具」及其 IPC。CLI、Agent API、`docs/agent-api/`。
- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- `core/` 不是 rustfmt-clean：只用 `rustfmt --check` 核你改过的文件，别跑 `cargo fmt --all`。`gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add <文件…>` / `git rm <文件…>` 后 `git commit`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- 盘点 `grep`（上面那串）在 `core/ cli/ runner/ gui/src docs/ipc-protocol.md docs/design docs/ga-baseline.md` 里为空（旧 devlog、`managed-ga/code/` 上游文件除外）
- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`CI=true pnpm --dir gui test`
- runner：在 worktree 根目录用主树的 venv 跑 `<主树>/.venv/bin/python -m pytest`（先打印 `runner.__file__` 确认指向 worktree）、`<主树>/.venv/bin/python -m mypy runner`、`<主树>/.venv/bin/ruff check runner`
- 门禁脚本（CI 前置门禁那六个）：`node scripts/check-ipc-protocol-drift.mjs`、`check-supervisor-sop-drift.mjs`、`check-docs-links.mjs`、`check-version-consistency.mjs`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs`
- 改过的 Rust 文件 `rustfmt --check`；`git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 删掉的文件与符号清单（按 runner / Core / GUI / 文档）；盘点 `grep` 删前删后的结果。
3. 看门狗与关闭流程里清理子进程那几处的 diff 原样。
4. 标题菜单删项后的样子（菜单项列表，前后对比）。
5. 每条验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方。

## Comments
