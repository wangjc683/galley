# GA 上游升级 `f06d550` -> `30b24ad`

日期：2026-08-21
范围：`f06d5503808ba9d164fb583e4c500d5ce01efd4c` ->
`30b24ad31d679cde47a75f47fb6880df1dd96891`（8 提交，7 文件，
~52 insertions / ~31 deletions）
相关：`managed-ga/manifest.json` · `managed-ga/patches/{0001,0002,0008}` ·
`docs/ga-baseline.md` · [上一段升级](./2026-08-14-ga-upstream-upgrade-308153b-to-f06d550.md)

baseline 引入以来最小的一段，从上一段手里接过这个名号；也是 `ga-baseline.md`
有记录以来**第一次零冲突** rebase——此前每一段都至少有一处真冲突。上一段的教训是「真正的工作量在补丁栈 rebase 不在外审」，
这一段两头都很轻——值得记的不是工作量，而是三条引擎改动里有一条需要 dogfood 盯。

## 形状

引擎核心只动了两处：`ga.py` **1 行**、`llmcore.py` **5 / 2**。`agent_loop.py`
和 `agentmain.py` 零 diff。`pyproject.toml` 动了，但只动 `ui` extra 那一行
（`streamlit>=1.28` -> `>=1.62`）——**`[project.dependencies]` 没变**，而
`bundle-python.sh` 的 `GA_DEPS` 镜像的正是那份核心清单，streamlit 从来不在里面，
所以打包运行时不受影响。

剩下的全是上游自己的东西：Streamlit 前端 `stapp.py`（46）、`hub.py`（6）、
`mykey_template.py`（+20，纯注释）、一张微信群二维码。

按 08-14 那次的教训，**这次仍然从零重跑了打包门禁**，没有拿「`GA_DEPS` 未变」
去省它——那条论证回答的不是门禁在问的问题。

## 三条引擎改动

### 1. `context_management` 被上游关掉（唯一需要 dogfood 盯的一条）

上游 `3f39e2b`。此前每次 `NativeClaudeSession.raw_ask` 都会在 payload 里发

```python
payload["context_management"] = {"edits": [{"type": "clear_thinking_20251015", "keep": "all"}]}
```

现在这行被注释掉了，而 `anthropic-beta` 头里的 `context-management-2025-06-27`
**留着没动**。上游 commit message 只写了「disable claude context_management」，
没给理由。

对 Galley 的耦合面是空的：补丁 `0016`（native thinking tags）和 `0017`
（usage accounting）读的都是 `_parse_claude_sse` 里的 SSE 流，不碰请求体。所以
**不需要改任何代码**。

但这是本段里唯一一条会改变线上行为的：native Claude 会话不再请求服务端做那次
thinking 清理，长对话的 input token 计数可能变。**dogfood 时跑一轮长的 native
Claude 会话看用量**，这是本次升级里唯一值得专门看一眼的地方。

### 2. `api_key_header`：上游新能力，Galley 免改即通

上游 `c9cb4b5`（社区 PR #751）。`NativeClaudeSession` 新增可选配置键，取值
`auto`（默认，仍是旧的 `sk-ant-` 前缀启发式，行为逐字节不变）/ `x-api-key` /
`bearer`。存在的理由是那类「说 Anthropic `/v1/messages` 协议、但 key 不带
`sk-ant-` 前缀」的中转（上游举的例子是 opencode.ai）：`auto` 会发 `Bearer`，
而那种端点只认 `x-api-key`，结果是 401。

**Galley 这边不用改任何代码就已经能用**：`managed_runtime.managed_model_config_from_env`
里是 `cfg.update(advanced)`，模型的 `advancedOptions` 原样透传进 GA 的 session
cfg。这是当初把 advancedOptions 做成自由字典（而不是白名单）的红利。

差的只是入口：Settings -> Models 的高级面板编辑的是一组**策展过的字段**
（`max_retries` / `read_timeout` 等），`api_key_header` 不在其中，所以用户现在
**没法在 GUI 里把它敲进去**。要不要给它一个字段、或者放进某个预设的
`recommendedAdvancedOptions`，是个产品问题，不在本次升级范围内，已记
[台账](./deferred.md)。

### 3. `ga.py` 的 `!!!Error:` 尾部判定：一致性修复，不是策略反转

`do_no_tool` 的不完整回复判定里，`'!!!Error:' in content[-100:]` 改成
`content[50:][-100:]`。

第一眼像是「硬失败不再重生成了」，实际不是。关键在于**这只影响短内容**：
内容一过 ~150 字符，两个表达式就是同一段切片。所以一条长的
`!!!Error: HTTP 4xx: {body}`——标记在头部、`content[-100:]` 取的是尾巴——
**改之前就已经落不进这个判定**。这次只是让短的那种跟长的那种行为一致：
短硬失败第一次就把错误文本交出来，而不是先烧掉 `_retry_or_exit` 的三次重生成。

Galley 的模型探针不受影响：`probe.rs` 直接调 `backend.raw_ask`，根本不进
`do_no_tool`。

## 为什么零漂移预期下仍然走 rebase 脚本

外审阶段就能算出来：上游给 `llmcore.py` 净加了 3 行（`api_key_header` 的
`__init__` 赋值 1 行 + 鉴权分支 1→3 行），位置在 762 附近；补丁栈里 `0001`
（`_write_llm_log`）、`0002`（`_ensure_text_block` / `tryparse`）、`0008`
（`NativeToolClient`）的 hunk 全在那之后。

预期只有 +3 行的纯位置漂移——听上去正是「手改两个行号就行」的量级。但
`0002` 那条是 `@@ -1011,0 +1012,47 @@`，**零上下文的纯插入**：没有被删除行可供
`git apply` 校验，错位时不会报错，只会静默落错地方。这正是 07-15 那次踩过、
`build-managed-ga.sh` 后来加 `py_compile` 扫描要防的那一类。

所以照文档走 `rebase-managed-ga-patches.sh`。结果印证了预期：19 条全部重放，
旧链字节比对与 `managed-ga/code` 一致，rebase 零冲突，三个补丁文件重新导出后
**只有行号变了、正文一字未改**：

```
0001: @@ -1017 +1017,2 @@  ->  @@ -1020 +1020,2 @@
0002: @@ -1011,0 +1012,47 @@ ->  @@ -1014,0 +1015,47 @@   (+3 处同款)
0008: @@ -1397,2 +1397,3 @@ ->  @@ -1400,2 +1400,3 @@
```

上一段升级的结尾写的是「零上下文 hunk 只发生位置漂移并被 rebase 自动带走，
正是不手改 hunk 的理由」。这一段是同一句话的第二次兑现。

## 验证

- `rebase-managed-ga-patches.sh`：旧链重放 = 已提交 payload，字节一致；rebase 19/19 零冲突
- `build-managed-ga.sh`：19 条全部 clean apply，`py_compile` 扫描 OK
- `check-managed-ga-payload.mjs`：OK
- `check-ga-baseline-drift.mjs`：OK（`30b24ad3`）
- `pytest runner/tests/ -m 'not e2e'`（`GA_PATH` 指向新 checkout）：**234 passed**
- `bundle-python.sh mac-x64` + `check-bundled-python-managed-ga.sh`：从零重建，
  bundle 161M，managed GA import OK
- 本机 x86_64，`mac-arm64` / `win-x64` 物理不可验（打包脚本要跑 bundle 里的
  python 装依赖），归 `release.yml` 的 runner

未做：e2e（要真 GA + LLM 额度，可选项）；两种运行模式的真机 dogfood 归 JC。

## 遗留

- **dogfood 盯 `context_management`**：native Claude 长会话的用量表现（见上文第 1 条）
- **`api_key_header` 的 GUI 入口**：已记 [deferred](./deferred.md)，本次不做
- `hub.py` 的 put 类型校验、`stapp.py` 的 Streamlit 修复、二维码刷新：全部
  inert 在 Galley 路径上。`grep -rn "hub.connect" managed-ga/code/` 仍然只命中
  `agentmain.py --reflect` 和 `stapp.py`，两者 Galley 都不跑——这条便宜的守卫继续有效
