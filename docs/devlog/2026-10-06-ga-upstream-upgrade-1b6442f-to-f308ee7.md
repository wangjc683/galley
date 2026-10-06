# GA 上游升级 1b6442f -> f308ee7

**日期**：2026-10-06
**上下文**：上游 `main` 从 09-30 起停在 `f308ee7`，v0.5.5、v0.5.6、v0.6.0 三次发版都没有审计。
[v0.5.6 devlog](./2026-10-01-v0.5.6-release.md) 的建议是：记忆提炼提示词改的是用户状态，基线审计应单独做一次，
不和发版绑在一起。JC 本次直接要求「做一次 GA Baseline update」，所以在 v0.6.0 之后、下一个版本之前单独完成。

## 范围形状

`1b6442f..f308ee7` 共 8 个提交、10 个文件，+401 / −50。按 SOP，先分类，再读 diff：

- 引擎核心：`ga.py`（+4 / −10，记忆提炼提示词）、`llmcore.py`（2 行 UA）、`agentmain.py`（+1，只在 reflect 分支里）。
  `agent_loop.py` 和 `pyproject.toml` 没有改动，`GA_DEPS` 不用动。
- 上游前端：`tuiapp_v2.py`（+296 / −22，`e86ca72`）、`stapp.py`（+42 / −10）、`hub.py`（+43 / −5）。
- `memory/` 种子：`subagent.md`、`memory_cleanup_sop.md`。
- README 与社群二维码（`9d1add7`、`2538ad9`）。

## 引擎 delta

- **记忆提炼提示词重写**（`f308ee7`，`do_start_long_term_update`）。这是前三次跳过时点名、要单独给结论的一项。
  - 旧版最后一句是「先 `file_read` 看现有 → 判断类型 → 最小化更新 → 无新内容跳过，保证对记忆库最小局部修改」。
  - 新版改成「先读后patch，将已验证、长期有用且难以重建的新知识融入旧条目，合并重复、压缩冗述，不堆叠流水账」，
    同时限定「不得为缩短而丢失关键事实、适用条件和踩坑信息」。也就是说，一次提炼不再只是追加新事实，还可能合并、压缩已有条目。
  - 新增两句：「不得将模型推测或建议记作用户要求」「记忆整理仅是内部收尾；完成或跳过后，仍须向用户报告原任务结果」。
    `get_global_memory()` 从指令后面挪到了前面。
  - Galley 代码侧没有耦合：GUI 的工具条只读调用参数（`ToolCallout.tsx` 的 `start_long_term_update` 分支），
    工具输出的 `[Info] Start distilling…` 也没变。
  - 对照宪法第 1 条：写入仍然是引擎自己用 `file_patch` 写进内置状态根的 `memory/`，升级本身不覆盖任何记忆（种子只补缺失文件）。
    变化只在于一次提炼能改动已有条目的多少。
  - 用量（workbench.db 只读，10-06）：140 个会话里调用了 3 次，都发生在旧提示词下，每次都是「先读 L1 / L2，再做最小 patch」。
    频率低，但每次写的都是用户状态。
  - 结论：采用上游行为，不加补丁。观察项写进 ga-baseline 和 project-status：在新基线上跑过头几次内置记忆提炼后，
    对比 `memory/` 的前后差异；如果出现丢事实、丢适用条件，退路是加一个一行的托管补丁，把「最小局部修改」改回来。
    现在不加，理由有两条：上游行为是默认选项，也还没有观察到丢失。
- **claude-cli UA `2.1.251 → 2.1.280`**（`f308ee7`）：Galley 的托管模型配置不设 `user_agent`，
  内置的 native Claude 会话会直接用上新版本号。顺带发现，Core 连接探测（`managed_model_probe.rs`）里写死的是 `claude-cli/2.1.113`，
  05-25 以来上游已经升过三次版本号（`2.1.152`、`2.1.251`、`2.1.280`，`git log -G` 核实），探测一直没跟。
  这一项不属于基线同步面，本次只记录、不改。
- **reflect 脚本可以用模块级 `LLM` 按名字选 backend**（`c913871`）：这行代码在 `if __name__ == '__main__':` 里，
  而 Galley 在两种模式下都不启动 `--reflect`（见 [GA 调度器 devlog](./2026-10-01-ga-scheduler-managed-mode.md)），够不着。

## 前端与种子

- `hub.py`（`9dcbf5a`）：新增 `inject` 操作（运行中插话，写入 `agent.intervene` / `agent.extrakeyinfo`，`ga.py` 的 turn-end
  本来就会读这两个属性）、HTTP `/intervene` 与 `/keyinfo` 接口、`hub.call()` / `hub.peers()` 客户端，并把 token 持久化到
  `temp/.hub_token`。这个文件落在**代码根**的 `temp/` 下，绕开了 `GALLEY_GA_STATE_ROOT`，按 SOP 第 5 步要单独记录。
  但只有 hub 服务端（`python hub.py`）会写它，服务端又依赖 `fastapi` / `uvicorn`；在重建后的 bundle 上 import 核过，这两个包都没有，
  所以内置运行时起不了 hub 服务端。不打补丁。`hub.connect` 守卫照旧只命中 `agentmain.py --reflect`、`hub.py` 自身和 `stapp.py`。
- `memory/subagent.md` 新增「Hub：向已有 agent 投递消息」一节，`memory/memory_cleanup_sop.md` 新增「L3 内容审计」一节。
  两份都随种子只补缺失：老用户还是旧文件，新装才拿到新版。内置模式下 Hub 这一节走不通（没有 hub 服务端），
  agent 照着做最多是一次调用失败，没有副作用。
- `stapp.py`（Streamlit WS 发送队列不再设上限、长回答折叠）、`tuiapp_v2.py`（上游 TUI 渲染打磨）、README 与二维码：都不在 Galley 路径上。

## 补丁栈 rebase

`rebase-managed-ga-patches.sh f308ee7 <scratchpad clone>`：旧链重放后与已提交 payload 逐字节一致，rebase 到新基线时**零冲突**。

- `0001`、`0003` 只漂了行号（`ga.py` 在提炼提示词以下 −6 行，`agentmain.py` 在 reflect 分支 +1 行），
  `git diff managed-ga/patches` 里没有 body 行变化。
- `0024` 重新导出后少了两行文本 `index`。这是脚本的规范化：`0024` 当初是手工导出的，其他补丁早就是这个格式。
- `build-managed-ga.sh`：27 个补丁全部应用，`py_compile` 全量扫描通过；`check-managed-ga-payload.mjs` 通过。
- 另做了一次比对：重建后的 payload 相对旧 payload 的 diff，在每个改动文件里都和上游 diff 逐行相同；两份种子文件与上游逐字节相同。
  说明补丁没有落错位置。

## 验证

- 兼容矩阵 `GA_PATH=<f308ee7 clone> pytest runner/tests -m 'not e2e'`：496 passed。`runner/` 没有改动，ruff / mypy 不需要重跑。
- 打包门禁 `bundle-python.sh mac-x64`：162M，`managed GA import OK`。
- `check-ga-baseline-drift.mjs --write` 之后四个面都通过（manifest.json、ga-baseline.md、patches/manifest.md、project-status.md）。
- **未做**：SOP 第 8 步（dev 模式下两种运行时各跑一个真任务，加上各 IM 渠道的重启检查）。本次引擎 delta 不碰 run 循环、
  日志格式和 IM 前端，风险低，所以并入下一版的 draft 冒烟；冒烟时顺带看一次内置的长期记忆提炼。

## 起源纪律

本次没有「上游吸收了 Galley 能力」这类说法需要考据。提示词重写、UA、hub inject 都是上游自己的演进：`git log -G '记忆提纯'`
只命中 `f308ee7`（Liang Jiaqing，09-30），`_inject` 出自 `9dcbf5a`（09-26）。上游没有动 `auto_make_url`，也还没有消费
`task["images"]`，补丁 `0027`、`0008` 都保留。
