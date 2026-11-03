# 126 子任务的标题由主对话写在标签上

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 175。改 Core（解析标签、建子任务会话、回放）、Core 与 GUI 剥标签的两份实现、入口层派活那一句、它们的测试，和评测加载器认标签的地方；不动 Agent API 结构、迁移、手册、runner。只影响内置运行时；外置没有主对话，零变化。之后由同一个代理接着做票 [127](./127-parallel-dispatch.md)，两张票改同一段提示词。

## 为什么

子任务的标题现在是一长句：Core 拿指令第一行截到 80 个字当标题（`core/src/subtask.rs:150-165` 的 `subtask_title`），建会话时给了标题的一律记成「用户起的名」（`core/src/db/helpers.rs:284-288`，标题不等于默认名就是 `user`），而自动起标题只改 `seed` / `derived`（`core/src/db/session.rs:1196`）。本机 3 件子任务的标题全是 81 个字（80 个字加省略号）。卡片、待办面板「Galley 在办」、⌘K 读的都是它。

## 要做到

### 1. 标签语法

- `<subtask title="短标题">指令</subtask>`；不带属性的 `<subtask>指令</subtask>` 照旧有效。
- 解析在 `core/src/subtask.rs`（`OPEN` / `CLOSE` 常量、`SubtaskTag`、约 `:92-142` 的读法）。开标签是 `<subtask` 后面跟空白加一个 `title="…"`（双引号，值里没有 `"` 和换行），再接 `>`。
- 别的属性、写坏的属性、单引号：开标签照样读到第一个 `>` 为止，仍是这个标签，标题按没写处理；派活本身不受影响。
- `<subtask` 后面紧跟的既不是 `>` 也不是空白（比如正文里的 `<subtasks>`），不算标签。现在的行为若与此不同，按现在的来，在报告里说明。
- 标题的清理：去首尾空白，连续空白并成一个，再用 `derive_title_from_text` 那套截断兜底（80 个 UTF-16 单位）。清理后为空，就当没写。
- `Unclosed` 的开标签里写了标题，用它；`Empty` 照旧。

### 2. 建子任务会话

- 有标题：会话标题用它，`title_source` 照现在记 `user`。
- 没有标题：用 `subtask_title(指令)`，`title_source` 记 `derived`，让 `crate::auto_title` 在它第一轮跑完后换成模型起的标题。`auto_title.rs` 文件头说子任务的 runner 也挂着这个 watcher，核实一下。
- 现在建会话的路径（`create_subtask` → `create_subtask_session` → `helpers.rs:284` 按标题是否等于默认名定 `seed` / `user`）要能传 `derived`。最小改法自定，报告里说明。
- `subtask_dispatches.title` 记的是派出时的标题。核一下卡片、待办面板、⌘K、回放那一行（`[subtask <id>: <title>]`）各读的是记录的标题还是会话当前的标题。会话还在时应该显示会话当前的标题，否则自动起标题换了名，卡片上还是长句。不一致的改到一致，只有没起成会话（没开始、起不来）的才读记录；在报告里列出各处读的是哪个。

### 3. 剥标签（两份实现要一起认带属性的开标签）

- Core 派生回合正文时剥标签，在哪里请 `grep -rn "<subtask" core/src` 找（`subtask.rs` 文件头说是 `turn_persistence::derive`）。
- GUI 的镜像在 `gui/src/lib/ipc/ga-output-cleaning.ts:18-30`，含未闭合的那条。
- 两边都要认 `<subtask title="…">`，否则 `title="…"` 会漏进对话正文，未闭合的也一样。两边各加测试。若有 golden fixture 钉住两边一致（`grep -rln "subtask" core/tests/fixtures gui/src`），一起补。

### 4. 入口层那一句

- `core/src/managed_prompt.rs:458-460`：把标签写成 `<subtask title="a few words">what to do</subtask>`。
- 紧跟一句（英文，照附近的口气）：标题是用户在列表里看到的，用用户的语言，几个字说是哪件差事。
- `managed_prompt` 测试里断言这一句的地方（约 `:1402`）跟着改。
- 派活判据不动，并行那一句是票 127 的。
- `core/src/managed_prompt.rs:430-449` 的文档注释补一句为什么（裁决 175）。

### 5. 评测加载器

`.scratch/main-chat/entry-layer-eval/run.py`（以及 `dispatch-criterion` 的判定）如果按字面 `<subtask>` 认标签，改成也认带属性的，并把标题读出来，给票 127 判标题用。`--dry-test`（不连模型）要过，这张票不跑真模型。

### 6. 看到没改的要报

凡是认 `<subtask>` 字面的别处（手机端、IM、文档里的示例），列进报告，不扩范围。

## 验证

在 worktree 根目录跑：

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
git diff --check main...HEAD
PYTHONDONTWRITEBYTECODE=1 /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 .scratch/main-chat/entry-layer-eval/run.py --suite dispatch-criterion --dry-test
```

- `core/` 不是 rustfmt-clean：只对动过的 `.rs` 跑 `rustfmt --check --edition 2021`。`gui/` 不是 prettier-clean：只管自己的 hunk。
- 中文全角标点：在 scratchpad 写 `cjk-punct-126.py`，扫 `git diff main...HEAD` 的新增行。

## 别动

- 只在 worktree 里改，绝不碰主工作树 `/Users/inkstone/Documents/genericagent-webui`；不跑 `tauri dev`，不跑 `galley` 写命令，不写用户的 `~/Library/Application Support/app.galley`（评测脚本只读打开库，照旧）。
- Agent API 结构、迁移、手册、runner、managed-ga 不动。已有子任务的标题不回填。

## 提交与回报

- 在 worktree 分支上提交，只点名本票文件，禁用 `git add -A` / `git commit -a`。提交说明用英文，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，命令后接 `git log --oneline -1`，提交号只抄输出。
- 报告：①改了哪些文件 ②提交号 ③每条验证命令与结果（测试条数）④偏离票面的地方与理由 ⑤看到没改的 ⑥Open risks。
