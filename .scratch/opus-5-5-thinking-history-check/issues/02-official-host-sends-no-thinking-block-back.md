# 发往 Anthropic 官方地址的请求不带回思考块（补丁 0034）

Status: ready-for-agent
日期：2026-11-17
来源：票 01 当天在 dev 里复现；三种修法并排给 JC 后，JC 裁「不把思考块发回去，范围只限官方地址」。执行前先读 `docs/agents/dispatch.md`。

## 现象与原因（已核实）

官方地址上用 `claude-opus-5-5` 跑一个逐步推理的工具任务，第 14 次请求返回：

```text
HTTP 400: messages.15.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. … Content before this block differs from when it was created, first at `messages.2.content.0`.
```

之后这个对话每发一句都是同一个 400。

- 接口：思考块的签名绑定了它之前的系统提示词、工具集和每一条消息；之前的内容改过，再把块发回去就是 400。2026-08-31 之后创建的账号默认强制。Sonnet 5.5、Haiku 5.5、Fable 5.1 同样，Fable 5.2 对所有账号强制。
- 内核：`NativeClaudeSession.ask` 每次请求前调 `trim_messages_history`，它每 7 次请求调一次 `compress_history_tags`，就地截短最近 10 条之外的旧消息（工具结果、标签文本超过 800 字符的）；截过的下次还会再截。带签名的思考块原样存进历史并发回。
- 另一条进历史的路：IM 渠道重启后、以及 `/continue N`，从内核日志恢复历史（`frontends/continue_cmd.py` 的 `_parse_native_history`），日志里的回复带着思考块，会原样装回去。所以修法放在发请求的地方，不放在存历史的地方。

主会话已在 dev 里用下面这段改动跑过同一类任务：40 次请求、其中 26 次回复带思考块、截短触发 5 次，没有报错。

## 1. 要改的文件

- `managed-ga/patches/0034-managed-official-anthropic-no-thinking-replay.patch`（新增）
- `managed-ga/code/llmcore.py`（载荷，由补丁生成）
- `managed-ga/manifest.json`、`managed-ga/patches/manifest.md`
- `runner/tests/test_managed_ga_llmcore.py`
- `docs/managed-ga-runtime/model-configuration.md`（「Official Anthropic API」一节）
- `docs/ga-baseline.md`（耦合点）

## 2. 怎么改

**内核改动**，在 `NativeClaudeSession.raw_ask` 里，紧接补丁 `0032` 的 `except ValueError: cc_identity = True` 那一行之后、`beta_parts = [...]` 之前，插入这 6 行（逐字）：

```python
        # Galley (0034): the official API ties each thinking block to the conversation before it, and returns 400
        # ("bound to a different conversation") once an earlier message changed; compress_history_tags and
        # trim_messages_history change them. There, send no thinking block back, however it got into history.
        if not cc_identity:
            for m in messages:
                if isinstance(m.get("content"), list): m["content"] = [b for b in m["content"] if not (isinstance(b, dict) and b.get("type") == "thinking")] or [{"type": "text", "text": "..."}]
```

规则：`api_base` 的主机名恰好是 `api.anthropic.com` 时（复用 `0032` 算出的 `cc_identity`，同一个判断），请求的 `messages` 里不带任何 `type` 为 `thinking` 的块；一条消息滤完为空时放一个 `{"type": "text", "text": "..."}`。其余主机发出的请求逐字节不变。`self.history` 不改（`raw_ask` 拿到的是 `ask` 与 `_fix_messages` 复制出来的列表，测试里要守住这一点）。

**补丁**：按 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Add A Patch」做。`0034` 是对「已提交的、`0033` 之后的 `llmcore.py`」的零上下文 diff，路径写 `a/llmcore.py`、`b/llmcore.py`，排在栈的最后；`0032`、`0033` 不需要重新导出（`0034` 只新增行，位置在两者改动之后或之间时核对行号）。`manifest.json` 的 `patchStack.patches` 末尾追加文件名。`manifest.md` 加一行（原因、动到的上游文件、rebase 风险：依赖 `0032` 的 `cc_identity`；移除条件：上游让 Anthropic 协议的历史只追加不改写，或自己处理这项校验），并更新「Last replay verified」一段。

**重放**：从新克隆的上游（`manifest.json` 里的 `upstream.source`，含 `upstream.commit`）跑 `scripts/build-managed-ga.sh <clone>`，之后 `git status` 干净。克隆放 scratchpad。

**测试**（`runner/tests/test_managed_ga_llmcore.py`，照 `test_official_anthropic_api_sends_no_claude_code_identity` 一组的夹具写）：

1. 官方地址：历史里助手消息带签名的思考块加文本加 `tool_use`，发出的 `messages` 里没有思考块，其余块原样、顺序不变。
2. 官方地址：只含一个思考块的助手消息，发出去是 `[{"type": "text", "text": "..."}]`。
3. 其他主机（第三方地址，以及 `api.anthropic.com.example.net` 这类只是包含的）：思考块照旧发回。
4. 官方地址：发完之后 `session.history` 里的思考块还在。

**文档**：

- `model-configuration.md`「Official Anthropic API」一节加一段：官方地址上不发回思考块，原因（上面的校验与内核的历史压缩），认下的代价（模型看不到自己之前各步的推理，靠每步的 `<summary>` 与工作记忆接续，对回答质量的影响没有量过），不覆盖的（经第三方地址转到 Anthropic 的强制账号仍会撞）。
- `ga-baseline.md`：在耦合点里记一条，基线升级时人工看：`compress_history_tags` / `trim_messages_history` 是否仍然就地改写历史；`_parse_native_history` 是否仍把日志里的思考块装回历史；上游若在 `raw_ask` 里改了 `messages` 的构造，`0034` 的插入点要跟。编号接着现有最大的耦合点往下排。

## 3. 验证命令

在本票的 worktree 根目录跑；Python 用主 worktree 的 `.venv`（`git worktree list` 的第一项）。

```bash
GA_PATH="$PWD/managed-ga/code" <main>/.venv/bin/python -B -m pytest runner/tests/test_managed_ga_llmcore.py -q
GA_PATH="$PWD/managed-ga/code" <main>/.venv/bin/python -B -m pytest -q
<main>/.venv/bin/python -m mypy runner
<main>/.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

另外演示一次测试是真的：把载荷里那 6 行临时去掉，测试 1、2、4 应当红；恢复后全绿。报告里写出红的是哪几条。

## 4. 不要碰的

- `core/`（「测试模型」只发一条消息、请求头没变，防漂移测试不受影响）、`gui/`、其他补丁文件。
- 不加 `omit_thinking` 配置，不加 `drop_block` 与任何新的 beta 头，不改 `compress_history_tags` / `trim_messages_history`。
- `docs/devlog/`、`docs/project-status.md`、`deferred.md`、发版文档、本目录的票 01：主会话写。
- 不碰主 worktree，不跑 `tauri dev`。

## 5. 报告格式

照 `docs/agents/dispatch.md`「Standing constraints」的四段：改了什么（文件与提交号）；验证命令与输出；未解决的风险与没验证到的；票外发现。

## 6. 真机

| 主会话代验 | 只有 JC 能验 |
|---|---|
| dev 里官方地址的 `claude-opus-5-5` 跑逐步推理的工具任务，跑过第 21 次请求，内核日志里没有 400；之前卡死的那个会话再发一句能接着走 | 无 |

## Comments
