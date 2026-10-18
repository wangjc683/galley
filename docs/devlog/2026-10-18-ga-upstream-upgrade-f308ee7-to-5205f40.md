# GA 上游升级 f308ee7 -> 5205f40

**日期**：2026-10-18
**上下文**：上游 `main` 停在 `f308ee7` 半个多月后，10-11 起连着动了 17 个提交，最后一个是今天上午的 `5205f40`。
JC 要求「做一次 GA Baseline update」，在 v0.6.2 之后、下一个版本之前单独完成，和 10-06 那次一样不绑发版。

## 范围形状

`f308ee7..5205f40` 共 17 个提交、188 个文件，+1014 / −28492。按 SOP，先分类，再读 diff：

- 上游把自己的 Desktop 应用移出了仓库（`5a4b6fa`、`250a7c2`）：164 个文件、2.75 万行删除，`frontends/desktop/`
  只剩一个 README（「maintained independently in a private repository」）和一个忽略其余内容的 `.gitignore`，
  两个 desktop CI workflow 也删了。
- 引擎核心：`agentmain.py`（+84 / −66）、`llmcore.py`（+63 / −34）、`ga.py`（+16 / −32）。
  `agent_loop.py` 和 `pyproject.toml` 没有改动，`GA_DEPS` 不用动。
- 补丁触及的文件里，上游改了 `agentmain.py`、`ga.py`、`llmcore.py`、`frontends/continue_cmd.py` 四个。
- 上游前端：`desktop_bridge.py`、`conductor.py`、`data_backup.py`、新文件 `desktop_history.py`（会话只存元数据、去掉全局默认模型），
  `stapp.py`、`tuiapp_v2.py`。
- `memory/` 种子：`memory_management_sop.md`、`memory_cleanup_sop.md`。`mykey_template*.py` 重写。

## 引擎 delta

### mykey 加载挪进 `MyKeys`：内置运行时硬断点

`a5979ea`（10-16）把模块级的 `_load_mykeys` / `reload_mykeys` 改成一个 `llmcore.mykeys_store`（`MyKeys` 类：
data、path、mtime、`updated_at` 时间戳，带锁），`agentmain.load_llm_sessions` 直接读 `mykeys_store.snapshot()`，
按 store 的 `updated_at` 与 agent 自己记的 `_mykeys_updated_at` 是否相同决定要不要重建。
`reload_mykeys()` 和 `_load_mykeys()` 只剩薄包装。

Galley 的 `install_managed_mykey_loader` 一直是替换 `llmcore._load_mykeys` 这个模块函数。新上游里 agentmain 的路径上
没人再调它，于是 store 自己去找 `mykey.py`，找不到就 stat `mykey.json`，失败后被 `reload()` 的 `except` 吞掉，
返回空字典。结果是内置模式下 `llmclient = None`：每个内置会话、每个 IM 渠道都会起不来。
用打包 Python 对着重建后的 payload 复现过（旧加载器：`AttributeError: 'NoneType' object has no attribute 'backend'`）。

修法在 runner，不加补丁：加载器改为替换 `mykeys_store._load`，返回 `(环境变量里的配置, None, None)`，并把 store 清空。
path 和 mtime 都是 `None`，`MyKeys.reload` 每次比较的就是 `None == None`，第一次加载后在进程内不再重载。这是有意的：

- 配置来自 Core 启动子进程时给的环境变量 JSON，进程活着时不可能变。
- Core 在每次 Settings 改模型后都会重写 `managed-models.json`（旧加载器 stat 的就是它）。如果照旧按它的 mtime 重载，
  加上下一节的新重建点，下一次任务开始时就会用同一份配置重建全部客户端，丢掉 Galley 写在 backend 上的
  `extra_sys_prompt`（内置提示词）和推理强度覆盖。
- runner 因此不再读 `GALLEY_MANAGED_MODEL_CONFIG_PATH`。Core 仍然设置它，这个文件也仍是 Core 的非机密配置，本次不动 Core。

测试：`test_managed_mykey_loader_serves_env_config_and_never_reloads`（对着真 payload 的 `llmcore`，旧加载器下失败）。
另用打包 Python 做了一次不花额度的端到端：装加载器、建 `GenericAgent`、`list_llms()` 列出两个模型，
把 marker 的 mtime 往后拨，再跑 `load_llm_sessions()` / `next_llm(0)` / `list_llms()`，backend 对象和 `extra_sys_prompt` 都没变。

### 任务开头与结尾重载模型：两个 bridge 适配

`2ba5529`（10-16）给模型重载加了 `_model_lock`：`load_llm_sessions` 和 `next_llm` 在 `is_running` 时直接返回；
`run()` 在每个任务开始（`is_running = True` 之前）和 `finally`（清掉之后）各调一次 `load_llm_sessions()`；
选中项按配置键（`_llm_config_keys`）而不是 backend 名字保持；配置为空时 `llmclient = None`。对 Galley 有两处影响，两种模式都在：

- **新的重建点**（契约第 13 条 (c)）。外置模式下，用户中途保存了 `mykey.py`，下一个任务开头 GA 会重建客户端，
  而 Galley 已经在旧 backend 上挂了一次性图片包装、写了推理强度覆盖：图片会静默发不出去，这一轮也会用模型自己的推理强度。
  修法：`Bridge._settle_llm_clients` 在每次 `put_task` 前（用户消息、ask_user 回答两处）先走一遍公共 API `list_llms()`，
  再重新应用覆盖，GA 自己在任务开头的那次调用就成了空操作。内置模式永不重建（上一节），这里只是一次廉价的复核。
  测试：`test_user_message_settles_a_client_rebuild_before_put_task`。
- **`next_llm` 在 GA 运行中静默不切**。Galley 拦 `set_llm` 用的是自己的 `run_in_progress`，它在本轮 `done` 或 ask_user
  的 turn end 时清掉，比 GA 的 `finally` 清 `is_running` 早一点点。`_handle_set_llm` 现在调用后核对 `agent.llm_no`，
  没切成就报业务错误，不再发一个没发生的 `llm_changed`。测试：`test_set_llm_reports_a_switch_ga_did_not_make`。
  这个窗口在人手操作下几乎碰不到，CLI 自动化紧接着 `wait` 切模型才有可能；核对只有几行，所以照做。
  微信的 `/llm` 回复里报的就是 `agent.llm_no`，本来就如实，不用改。

`run()` 的其他变化：斜杠命令现在在 `is_running = True`、`_current_queue = display_queue` 之后、`try` 之内处理
（返回 `None` 的走 `finally` 退出）；整段任务准备也挪进了 `try`，准备阶段出异常（没有模型、斜杠命令出错）会以带错误的
`done` 结束这个任务，不再直接打死运行线程，对 Galley 是正收益。契约第 15 条 (a) / (c)、第 17 条 (b) / (c) 照旧成立：
斜杠命令自己的 `done` 仍是 `source: 'system'`，一个任务仍只有一个其他 `done`，异常分支仍追加错误代码块。

### 其余引擎变化：知道就行，不用改

- **plan mode 删除**（`5205f40`）：`enter_plan_mode`、完成声明拦截、`📌` 步骤提示、plan 轮数上限都没了，
  `handler.max_turns` 对每一轮都是 180（仍由 `agent_loop` 设置，第 17 条 (a) 成立）。Galley 07-22 就拆了 plan 可视化链路。
  `memory/plan_sop.md`（那时起已标弃用）还在种子里、也还在老用户的状态里；模型若照着它调 `handler.enter_plan_mode`，
  工具输出里会是一个 `AttributeError`，没有别的后果。GUI 里提到 plan mode 上限的注释（`step-limit.ts`、`StepLimitTail.tsx`）
  对旧版外置 GA 仍成立，不改。
- **turn-end 提醒拉稀**（`5205f40`）：检查点提醒 13 → 17 轮一次，写文件提醒 31 → 41，全局记忆重注入 10 → 15，
  并包进 `<global_memory>…</global_memory>`，`compress_history_tags` 会像 `<history>` 一样折叠它（`67817cc`，社区 PR #834）。
  Galley 不读这些字符串。长任务的上下文里提醒更少、重复注入的记忆也更少。
- **L1 过大提示**（`5205f40`）：`start_long_term_update` 在 `global_mem_insight.txt` 超过 6000 字符时追加一句提示，
  读法是新函数 `load_L1()`。`0001` 把 `load_L1` 指向内置状态根，所以两个调用方读的都是用户的 L1，不是代码根的。
- **`code_run` 推断 shell**（`f7cadb6`）：`type` 为空时默认 python，脚本以 `ls` / `cd` / `git` / `curl` 等开头就按 shell 跑。
  Galley 的工具条只显示脚本首行，不显示类型，惰性。
- **DSML 结尾重试**（`f7e4cc5`）：回复以 `</｜DSML｜ calls>` 结尾（DeepSeek 的工具调用标记漏成了正文）时重新生成，
  不再当成最终回答。内置 DeepSeek 预设受益。
- `continue_cmd.extract_ui_messages` 拆出 `extract_ui_messages_text`、每条消息带 `ts`（`a2eb541`）。Galley 两个都不调，
  第 15 条 (f) / 第 16 条用到的函数没变。

## 前端与种子

- 上游 Desktop 移出仓库：不在 Galley 路径上。第 12 条参照的 `desktop_bridge._patch_chat_for_images` 逐字节没变。
  产品信号记一笔：上游的桌面 GUI 不再公开开发。
- `stapp.py` 的模型下拉跟随外部切换、`tuiapp_v2.py` 的 `/reload_keys` 改用 `mykeys_store.reload(force=True)`：惰性。
- `memory_management_sop.md` / `memory_cleanup_sop.md`：L3 SOP 越改越短、L1 只靠自解释的名字索引不加触发词、
  长期记忆的准入规则、删掉 `file_patch` 脏字符那一节。种子只补缺失，老用户还是旧文件。
- `mykey_template*.py` 重写成先给快速配置：内置模式从不读它，惰性。
- `hub.connect` 守卫照旧只命中 `agentmain.py --reflect`、`hub.py` 自身和 `stapp.py`。新增代码里绕开状态根的路径只有
  `load_L1` 那一处读取，已由 `0001` 重定向。

## 补丁栈 rebase

`rebase-managed-ga-patches.sh 5205f40 <scratchpad clone>`：旧链重放后与已提交 payload 逐字节一致；rebase 停了三次，
共四处真冲突，都是上游重排了补丁所改的代码，没有一处是补丁意图变了：

- `0001` / `ga.py`：上游把 L1 读取从 `get_global_memory()` 挪进 `load_L1()`。保留上游的 `insight = load_L1()`，
  把 `load_L1` 里的 `open` 改成 `state_path('memory', 'global_mem_insight.txt')`。
- `0001` / `agentmain.py`：`run()` 的任务准备整体缩进进 `try`。取上游的块，重新套上两处 `state_path('temp', …)`。
- `0003` / `ga.py`：与 `0001` 同一段；保留 `load_L1()` 和 `asset_path(...)` 的结构读取。
- `0008` / `agentmain.py`：同一次缩进。取上游的块，按新缩进重新插入 `initial_user_content = …` 和 `agent_runner_loop` 的关键字参数；
  `try` 上方的 `images =` 一行没动。

其余 23 个补丁自行 rebase，`0002`、`0007`、`0016`、`0017`、`0021`、`0025`、`0027` 只漂行号（`llmcore.py` 上方多了 29 行 `MyKeys`）。
`build-managed-ga.sh`：26 个补丁全部应用，`py_compile` 全量扫描通过；`check-managed-ga-payload.mjs` 通过。
另做了一次比对：payload 与上游树的差异只落在补丁触及的文件上，外加 `frontends/conductor.py` 的行尾空格规范化。

`0008` 里 `images = task.get("images")` 排在 `isinstance(task, str)` 判断之前，字符串哨兵会先抛 `AttributeError`。
这是旧问题，Galley 不往队列里放字符串（只有上游的 conductor / TUI 会），本次不动。

## 验证

- runner：`pytest` 553 passed；`mypy runner`、`ruff check runner` 通过。
- 兼容矩阵 `GA_PATH=<5205f40 clone> pytest runner/tests -m 'not e2e'`：553 passed。
- 打包门禁：`pyproject.toml` 零 diff，依赖不变，本次用现有的 `mac-x64` bundle 跑 `check-bundled-python-managed-ga.sh`：
  `managed GA import OK`。另加上面那次打包 Python 端到端（加载器、模型列表、不重建）。
- `check-ga-baseline-drift.mjs --write` 之后四个面都通过。
- **未做**：SOP 第 8 步（dev 模式下两种运行时各跑一个真任务，加上四个 IM 渠道的重启检查）。本次碰到了模型加载和 `run()`，
  比 10-06 那次风险高，最该看的是：内置会话能正常回答、Settings 改一次模型后已开的内置会话下一轮仍带内置提示词、
  外置会话中途改 `mykey.py` 后下一轮图片与推理强度仍生效、四个渠道启动后能回答。

## 起源纪律

本次没有「上游吸收了 Galley 能力」这类说法。`MyKeys`、模型锁、plan mode 删除都出自 Liang Jiaqing 10-16 至 10-18 的提交，
`<global_memory>` 折叠出自社区 PR #834（cuipengcx90）。上游没有动 `auto_make_url`，也还没有消费 `task["images"]`，
补丁 `0027`、`0008` 都保留。
