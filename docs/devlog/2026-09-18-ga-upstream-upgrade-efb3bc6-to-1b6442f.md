# GA 上游升级 efb3bc6 -> 1b6442f

**日期**：2026-09-18
**上下文**：v0.5.0 发版时 baseline 没动，project-status 留了「下一个版本审上游」。
本轮讨论「能不能发新版」时，我建议先发 v0.5.1 不带 baseline、审计推到 v0.5.2；
JC 裁决**现在就做 baseline update**，和 9 个已 dogfood 的提交一起发。

## 范围形状

`efb3bc6..1b6442f` = 10 提交，15 文件，+119 / −76。按 SOP 先分类再读：

- 引擎核心：`llmcore.py`（+16/−3）、`agentmain.py`（+3/−5）、`ga.py`（+3/−2）、
  `TMWebDriver.py`（1 行）。`agent_loop.py`、`pyproject.toml` 零 diff，
  `[project.dependencies]` 未动 → `GA_DEPS` 不用改。
- 上游 hub / p2p relay 线：`hub.py`、`hub.html`、`hub_p2p.py`、`p2p_ws_client.py`、
  `conductor.py`。Galley 路径不碰；grep 过没有新的 `memory/` / `temp/` /
  `model_responses/` 写入。
- `memory/` 种子三个文件；`assets/insight_fixed_structure*.txt` 提示词一行。

## 引擎 delta

- **abort 在响应头到达前也能拆连接**（`f07bfc5`）。旧做法走
  `active_response.raw` 摸 socket，但 `active_response` 要等 `requests.post`
  返回——也就是响应头到了——才存在；prefill 慢或 relay 没回应时 Force Stop 只能
  等 read timeout。新做法在 `llmcore` 导入时 monkey-patch
  `urllib3.connection.HTTPConnection.request`，按线程 ident 把 `conn.sock`
  记进模块级 `_INFLIGHT`，`abort()` 直接查表。Galley 正收益，runner 只调
  `agent.abort()`，直接继承。三条耦合注记进 ga-baseline：hook 是进程全局的
  （auto-title `side_ask`、IM 前端的 requests 都经过，只存引用，惰性）；
  `_INFLIGHT` 不驱逐但按线程 ident 复用，有界；runner 单测的 urllib3 桩要补
  `connection.HTTPConnection.request` 属性，否则 `import llmcore` 在收集期就炸
  ——这是本轮唯一的 Galley 侧代码改动。
- **`default_context_win` 35000 → 38000、`cut_msg_interval` 7 → 8**
  （`0fd024b`）。上次 30000 → 35000 的分析原样适用：Galley 显式 `context_win =
  90000`，裁剪 cap 不动，动的是作分母的 `maxlen_multiplier`
  （1.93 → 1.78，−8%），工具输出上限再缩一档（`code_run` 19285 → 17763，
  `file_read` 28928 → 26645）。dogfood 只需盯 `...[Truncated]...` 是否更早出现。
- TTFT 改在第一条 SSE 行打点（含隐藏 thinking）：上游自用 `STATS`，惰性。
- UA `2.1.152 → 2.1.251`（`71cf559`）：Galley 不设 `user_agent`，托管 native
  Claude 会话自然跟上。
- `str(switch_tab_id)` / `str(default_session_id)`（`71cf559`）：模型传数字
  tab id 时插件 session 查不到的修复，浏览器控制路径正收益。
- `remember` 工具提示加「任务成功或到检查点才提炼」；宪法第 3 条去掉「3 次失败
  请求干预」（RULES 里已有）。纯提示词，Galley 不补丁。
- `7fa5fa4` 微信轮询修复（v0.5.0 时点名的那条）：只走 conductor 模式；Galley
  把微信渠道钉在 `agent` 模式（`managed_im_supervisor.py`），惰性。`0004` 没漂。

## 补丁栈 rebase

`rebase-managed-ga-patches.sh` 跑出**两处冲突，都是平凡的**：上游一行改动紧贴
Galley 插入行，git 分不开而已。

- `0006` / `ga.py`：`browser_control_empty_msg()` 的下一行就是上游改
  `str(switch_tab_id)` 的那行。保两边。
- `0007` / `llmcore.py`：codex / credential-IPC 四个字段的下一行就是
  `default_context_win`。保 Galley 四行 + 上游新默认值。上次 30000 → 35000 也是
  这条线撞 `0007`，只要上游再调默认值就会再撞一次，属于已知形状。

另外 8 个补丁（`0001` `0002` `0003` `0008` `0016` `0017` `0021` `0022`）只漂行号，
`git diff managed-ga/patches | grep -v '^[-+]@@'` 没有 body 行。`0021` 的目标行
（`err = f"!!!Error: HTTP …"`）下方正好是上游新插的 TTFT probe 块，零上下文 hunk
若手改极易 mis-drop，走脚本是对的。

## 验证

- `build-managed-ga.sh /tmp/galley-ga-upgrade`：21 补丁全应用，`py_compile` 全扫
  OK；`check-managed-ga-payload.mjs` OK。
- 兼容矩阵 `GA_PATH=/tmp/galley-ga-upgrade pytest -m 'not e2e'`：补桩后
  260 passed。`ruff` / `mypy runner` 干净。
- 打包门禁 `bundle-python.sh mac-x64`（JC 的 Mac 是 Intel，别抄 arm64）：从缓存
  PBS 重建 162M，`check-bundled-python-managed-ga.sh` OK。
- `check-ga-baseline-drift.mjs --write` 后四面 OK（manifest.json、
  ga-baseline.md、patches/manifest.md、project-status.md）。
- SOP 第 8 步（dev 模式两种运行时各跑一个真任务）没在本 session 做，并入
  v0.5.1 draft 烟测：内置模式重点看 Force Stop 在等响应期间能否即刻拆流、
  工具输出截断有没有明显变早。

## 起源纪律

本轮没有「上游吸收了 Galley 能力」的说法要考据：abort 表法、`str()` 修复、
默认值都是上游自家的演进（`git log -S` 确认 `str(switch_tab_id)` 出自
`71cf559`，2026-09-02）。
