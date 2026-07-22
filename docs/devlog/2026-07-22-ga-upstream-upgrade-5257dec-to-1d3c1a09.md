# 2026-07-22 - GA upstream upgrade 5257dec -> 1d3c1a09

## Date / Status / Related

- Date: 2026-07-22
- Status: implemented in current worktree, pending release-owner acceptance
- Related:
  - [GA baseline](../ga-baseline.md)
  - [Managed GA patch stack](../../managed-ga/patches/manifest.md)
  - [Plan mode 可视化拆除](./2026-07-22-plan-mode-visibility-removal.md)
  - Upstream GA `1d3c1a09dfdaa76ba5dee82725fa599df7c16be4`

## Context

事件驱动升级：上游 `1d3c1a09`（2026-07-22 当天）正式弃用 plan mode，这是个
语义分水岭——早一天吃进来，新种子用户就少学一天旧 SOP。delta 很小：8 提交、
18 文件、~90/-63 行。`agent_loop.py`、`ga.py`、`pyproject.toml` 零改动，
契约面（ga-baseline.md 10 项清单）无破坏。

上游变化按 Galley 相关度：

- `memory/plan_sop.md` + insight 模板（`1d3c1a09`）：**plan mode 正式弃用**。
  横幅明令禁止再进入 plan mode、宣布文件将删除，替代路由 ultraplan（仍仅限
  用户明说）/ project_mode / 直接执行；`project_mode_sop` 进 L1 模板索引；
  历史触发条件从"3步"改写为"30步（已失效）"。`ga.py` 的 plan 运行时机器
  （`enter_plan_mode` / 📌 注入 / `plan_state.py`）本次未删——docs-first
  半删状态，但对新种子状态而言触发源已消失。
- `agentmain.py`（`51f76929`）：long-prompt 临时文件名改
  `user_prompt_{pid}_{time_ns}.md`，修并发同秒碰撞（upstream #665/#693）。
  Galley 多会话并发跑 GA，直接受益。
- `TMWebDriver.py` + 扩展（`6788fb21`）：本地 bottle server 拒绝带 `Origin`
  头的请求（挡网页对 localhost driver 的 CSRF），legacy 页内 DOM bridge
  （MutationObserver + `config.js`）整体移除，CDP 成为唯一通路。
- `llmcore.py`（`d69ec880` 内）：`maxlen_multiplier` 0.85 → 0.75，上下文
  裁剪更早介入。非契约变化，但长会话行为可感知，dogfood 留意。
- `frontends/conductor.py` / `stapp.py` / `desktop*`：conductor 对用户聊天
  消息发通知等，均为 Galley 不桥接的上游前端，inert。

## Patch stack rebase

commit-chain rebase，两处真冲突 + 一处存量漂移修复：

- **`0001`**：上游唯一性修复与补丁的状态根迁移撞同一行，合并为
  `state_path('temp', f'user_prompt_{os.getpid()}_{time.time_ns()}.md')`——
  两个语义都保留。
- **`0003`**：`cdp_cfg` 归一化 hunk 的目标代码被上游整块删除，hunk 落空即弃；
  `asset_path()` 其余归一化不变。
- **`0015` 存量漂移（重要教训）**：rebase 脚本的字节一致性门发现仓库 commit
  `2848c4b`（2026-07-20，图标态 UX 迭代）直接改了 `managed-ga/code` 扩展文件
  （`background.js` / `manifest.json` / 4 个 `-off` PNG）而未回写补丁——违反
  "payload 是生成物，永不手改"纪律。以已发货的 payload 为准（v0.3.4+ 实际
  ship 的就是它）重导出 `0015`，字节门通过后再 rebase。`content.js` 上
  补丁的角标删除与上游的 observer 删除双双保留。
  **教训**：改扩展这类 0015 领域的文件时必须走"改 payload → 立即重导出补丁"
  或直接改补丁重建；字节门这次兜住了，但漂移在仓库里躺了两天。

同版本升级完成的其他动作：`build-managed-ga.sh` 重建 + `py_compile` 扫描
通过；payload / drift 两道 mjs 门通过；`pyproject.toml` 无依赖 diff。

## Origin discipline

本次无 "upstream absorbed Galley capability" 类判断。上游 `51f76929` 的
并发修复与 Galley 无渊源（upstream issue #665）；plan mode 弃用是上游自身
方向（其 5257dec 时代已调弱触发），Galley 同日拆除可视化是跟随而非来源。

## Verification

- `node scripts/check-managed-ga-payload.mjs` / `check-ga-baseline-drift.mjs`
- `cargo check/test --workspace`、gui typecheck/lint/test
- runner pytest + mypy + ruff；`GA_PATH=/tmp/galley-ga-upgrade` 兼容矩阵
- `./scripts/bundle-python.sh mac-arm64` + bundled import smoke
- JC 双模式 dogfood 验收后 commit（本文写作时 pending）
