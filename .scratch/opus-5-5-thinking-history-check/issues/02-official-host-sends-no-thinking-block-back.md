# 发往 Anthropic 官方地址的请求只带回仍然有效的思考块（补丁 0034）

Status: ready-for-agent
日期：2026-11-17
来源：票 01 当天在 dev 里复现；三种修法并排给 JC 后，JC 先裁「不把思考块发回去，范围只限官方地址」，当天改裁为精确版（见「裁决改过一次」一节）。执行前先读 `docs/agents/dispatch.md`。

## 现象与原因（已核实）

官方地址上用 `claude-opus-5-5` 跑一个逐步推理的工具任务，第 14 次请求返回：

```text
HTTP 400: messages.15.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. … Content before this block differs from when it was created, first at `messages.2.content.0`.
```

之后这个对话每发一句都是同一个 400。

- 接口：思考块的签名绑定了它之前的系统提示词、工具集和每一条消息；之前的内容改过，再把块发回去就是 400。2026-08-31 之后创建的账号默认强制。Sonnet 5.5、Haiku 5.5、Fable 5.1 同样，Fable 5.2 对所有账号强制。
- 内核：`NativeClaudeSession.ask` 每次请求前调 `trim_messages_history`，它隔若干次请求调一次 `compress_history_tags`（代码里的间隔是 7，计数器是整个进程共用的；主会话实测两次截短发生在第 14、28 次请求），就地截短最近 10 条之外的旧消息（工具结果、标签文本超过 800 字符的）；每条消息只在第一次落到这个范围里时变一次（截短是幂等的），但这一次改动发生在后面的思考块产生之后。带签名的思考块原样存进历史并发回。
- 另一条进历史的路：IM 渠道重启后、以及 `/continue N`，从内核日志恢复历史（`frontends/continue_cmd.py` 的 `_parse_native_history`），日志里的回复带着思考块，会原样装回去。所以修法放在发请求的地方，不放在存历史的地方。

## 裁决改过一次（2026-11-17，先读这一节）

第一版的规则是「官方地址上一个思考块都不发回」，执行代理已按它做完（本分支的提交 `04f481e2`）。JC 看了真实用量后担心回答质量（他的运行里 78% 的请求落在超过 6 步的长运行里），改裁为**精确版：只滤掉失效的思考块，仍然有效的照常发回**。本票其余部分已按精确版改写；第一版的提交留在分支历史里不用管，在它上面接着改。

精确版主会话已在 dev 里跑过同一个链式任务：36 次请求、0 报错、结果全对。每次请求留下与丢掉的思考块数也记了：第 2–13 次请求留下的块从 1 涨到 14、丢 0；第 14 次请求（内核第一次截短旧消息）留 1、丢 15；之后再涨，第 28 次请求再丢一批。

## 1. 要改的文件

- `managed-ga/patches/0034-managed-official-anthropic-no-thinking-replay.patch`（改写；文件名不变）
- `managed-ga/code/llmcore.py`（载荷，由补丁生成）
- `managed-ga/manifest.json`（已有 `0034`，不用再动）、`managed-ga/patches/manifest.md`
- `runner/tests/test_managed_ga_llmcore.py`
- `docs/managed-ga-runtime/model-configuration.md`（「Official Anthropic API」一节）
- `docs/ga-baseline.md`（耦合点 26）

## 2. 怎么改

**规则**：`api_base` 的主机名恰好是 `api.anthropic.com` 时（复用 `0032` 算出的 `cc_identity`），一个思考块（`type` 为 `thinking` 或 `redacted_thinking`）只有在「它之前的请求内容与它产生时相同」时才发回；否则从这次请求里滤掉。「之前的请求内容」指系统提示词、工具集、它之前的每一条消息里除思考块以外的所有块。来历不明的块（从日志恢复进历史的、别的会话对象产生的）一律滤掉。一条消息滤完为空时放一个 `{"type": "text", "text": "..."}`。万一接口仍然返回那句 400，忘掉所有记录，下一次请求一个块都不带。其余主机发出的请求逐字节不变；`self.history` 不改。

**内核改动**，三处，都在 `NativeClaudeSession` 里。先撤掉第一版插入的那 6 行，再加下面三处（逐字）。

一，在 `__init__` 之后、`def raw_ask(self, messages):` 之前，加两个方法：

```python
    # Galley (0034): the official API ties each thinking block to the conversation before it (system, tools, every
    # earlier message) and returns 400 ("bound to a different conversation") once any of that changed; upstream
    # shortens old messages in place (compress_history_tags, trim_messages_history) and /continue reloads blocks from
    # the log. There, a thinking block goes back only while the request before it hashes as it did when the block
    # was produced; one such 400 forgets every block, so the next request carries none.
    def _galley_valid_thinking(self, messages):
        import hashlib
        D = lambda o: json.dumps(o, sort_keys=True, ensure_ascii=False, default=str).encode()
        known = self.__dict__.setdefault('_galley_thinking_prefix', {})
        h = hashlib.sha256(D([self.system, self.claude_compat, self.tools]))
        for m in messages:
            h.update(D(m.get("role"))); kept = []
            for b in (m["content"] if isinstance(m.get("content"), list) else []):
                if isinstance(b, dict) and b.get("type") in ("thinking", "redacted_thinking"):
                    if known.get(b.get("signature") or b.get("data")) == h.hexdigest(): kept.append(b)
                else: h.update(D(b)); kept.append(b)
            if not kept: kept = [{"type": "text", "text": "..."}]; h.update(D(kept[0]))
            m["content"] = kept
        self._galley_thinking_h = h
        return messages
    def _galley_note_thinking(self, blocks):
        D = lambda o: json.dumps(o, sort_keys=True, ensure_ascii=False, default=str).encode()
        known = self.__dict__.setdefault('_galley_thinking_prefix', {})
        h = self.__dict__.pop('_galley_thinking_h', None)
        if h is None or not blocks: return
        if len(blocks) == 1 and "bound to a different conversation" in str(blocks[0].get("text", "")): return known.clear()
        h.update(D("assistant"))
        for b in blocks:
            if isinstance(b, dict) and b.get("type") in ("thinking", "redacted_thinking"): known[b.get("signature") or b.get("data")] = h.hexdigest()
            else: h.update(D(b))
```

二，在 `raw_ask` 里，紧接 `0032` 的 `except ValueError: cc_identity = True` 那一行之后、`beta_parts = [...]` 之前：

```python
        if not cc_identity: messages = self._galley_valid_thinking(messages)
```

三，在 `ask` 里，紧接 `if content_blocks and (_injected := _ensure_text_block(content_blocks)): yield _injected` 那一行之后：

```python
        self._galley_note_thinking(content_blocks)
```

为什么指纹要在「产生时」记：下一次请求发出前内核可能已经截短了旧消息，等到那时再记，记下的就是改过之后的内容，块会被误判为有效。所以 `raw_ask` 把这次请求的哈希状态留在 `self._galley_thinking_h`，`ask` 拿到回复后接着往下算，给回复里的每个思考块记下它的前缀指纹。

**补丁**：按 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」做。`0034` 仍是对「已提交的、`0033` 之后的 `llmcore.py`」的零上下文 diff（三个 hunk，只有新增行），路径 `a/llmcore.py`、`b/llmcore.py`，排在栈的最后。`manifest.md` 的 `0034` 那一行与「Last replay verified」一段按新内容重写（原因、rebase 风险：依赖 `0032` 的 `cc_identity`、依赖 `ask` 里 `_ensure_text_block` 那一行的位置、依赖 `_fix_messages` 对同一段历史给出同样的结果；移除条件不变）。

**重放**：从新克隆的上游跑 `scripts/build-managed-ga.sh <clone>`，之后 `git status` 干净、重建的 `llmcore.py` 与提交的逐字节相同。上一轮留在 scratchpad 的克隆可以复用。

**测试**（`runner/tests/test_managed_ga_llmcore.py`）：第一版的 `0034` 一组按新规则改写，复用已有夹具。要有的用例：

1. 官方地址，连续几轮没有任何改动：上一轮回复里的思考块在下一次请求里原样发回，位置不变。
2. 官方地址，旧消息在两次请求之间被改写（直接改 `sess.history` 里一条更早的用户消息的文本，模拟内核的截短）：改写点之后产生的思考块不再发回，改写点之前的那个仍然发回；这次请求的回复里新产生的块，在再下一次请求里发回。
3. 官方地址，历史里有一个这个会话对象没见过的思考块（模拟从日志恢复）：不发回。
4. 官方地址，系统提示词或工具集在两次请求之间变了：之前的思考块都不发回。
5. 官方地址，只含一个失效思考块的助手消息：发出去是 `[{"type": "text", "text": "..."}]`。
6. 官方地址，接口返回带 `bound to a different conversation` 的 400 之后：下一次请求一个思考块都不带。
7. 其他主机（第三方地址，以及 `api.anthropic.com.example.net` 这类只是包含的）：思考块照旧全部发回，不管历史改没改。第一版的这组用例保留。
8. 官方地址：发完之后 `sess.history` 里的思考块都还在。

**文档**：

- `model-configuration.md`：把第一版加的那段改成新规则。写明：仍然有效的思考块照常发回；内核截短旧消息的那一刻，之前产生的块失效、不再发回（主会话实测是第 14、28 次请求各一回，不要写成固定间隔）；认下的代价是截短之前的推理模型不再看得到，对回答质量的影响没有量过；不覆盖经第三方地址转到 Anthropic 的强制账号；「测试模型」不受影响。
- `ga-baseline.md` 耦合点 26：按新实现改写。基线升级时人工看：(a) `compress_history_tags` / `trim_messages_history` 是否仍然就地改写历史；(b) `_parse_native_history` 是否仍把日志里的思考块装回历史；(c) `raw_ask` 里 `messages` 的构造（`_fix_messages`、`_drop_unsigned_thinking`、`_ensure_thinking_blocks` 之后、加 `cache_control` 之前）与 `ask` 里回复落进历史的那几行有没有变，`0034` 的两个插入点与哈希的输入（`self.system`、`self.claude_compat`、`self.tools`）要跟。

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

另外演示一次测试是真的：把 `raw_ask` 里那一行调用临时去掉，用例 2–6 应当红；恢复后全绿。报告里写出红的是哪几条。

## 4. 不要碰的

- `core/`（「测试模型」只发一条消息、请求头没变，防漂移测试不受影响）、`gui/`、其他补丁文件。
- 不加 `omit_thinking` 配置，不加 `drop_block` 与任何新的 beta 头，不改 `compress_history_tags` / `trim_messages_history`。
- 不改上面三处逐字给出的代码的逻辑。读下来认为有错，写进报告，不要自己改规则。
- `docs/devlog/`、`docs/project-status.md`、`deferred.md`、发版文档、本目录的票 01：主会话写。
- 不碰主 worktree，不跑 `tauri dev`。

## 5. 报告格式

照 `docs/agents/dispatch.md`「Standing constraints」的四段：改了什么（文件与提交号）；验证命令与输出；未解决的风险与没验证到的；票外发现。

## 6. 真机

| 主会话代验 | 只有 JC 能验 |
|---|---|
| dev 里官方地址的 `claude-opus-5-5` 跑逐步推理的工具任务，跑过第 28 次请求，内核日志里没有 400，结果与脚本算出的标准答案一致 | 无 |

## Comments
