# 07 内置内核载荷：不带演示媒体与测试，从指定提交取源

Status: needs-dogfood（2026-11-10 合入；打包映射与包体积要等下次发版的 CI 与安装包核对）

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 D22、D23（JC：「按建议推进」）。

先读 `docs/agents/dispatch.md`、`AGENTS.md` Rule 1、`docs/managed-ga-runtime/README.md` 与其中讲代码、状态与补丁的一篇、`docs/ga-baseline.md` 的「当前基线」与升级步骤、`managed-ga/patches/manifest.md` 的表头。

## 背景

- 已发布的 v0.7.7 安装包里，`managed-ga/code/assets/demo`（四个 GIF、两张 PNG）约 19 MB，一份技术报告 PDF 约 3 MB，只有上游自己的 README 引用它们；`runner/tests`（约 700 KB，27 个 pytest 文件）也被打进了包。同样的字节进每一个更新包。
- `scripts/build-managed-ga.sh` 默认从维护者主目录下的 GA 检出复制**工作区**，只核对提交号与 `git status`；被 `.gitignore` 忽略的目录（上游的定时任务目录、前端临时目录等）`git status` 看不见，rsync 的排除清单也没列，一旦检出刚好在基线提交上，这些用户状态会被复制进载荷，而 Galley 仓库里 `managed-ga/code/.gitignore`（上游带来的）又会把它们藏起来，载荷门禁也不查。今天只是因为提交号对不上才被拦下。

## 1. 改哪些文件

- `scripts/build-managed-ga.sh`、`scripts/check-managed-ga-payload.mjs`、`scripts/check-managed-ga-app-bundle.mjs`
- `managed-ga/code/`（重建后少掉演示媒体与 PDF）、`managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`（如果它们记录文件数或校验）
- `core/tauri.conf.json` 里打包 `runner/` 的资源映射
- `docs/managed-ga-runtime/` 与 `docs/ga-baseline.md` 里描述载荷定义与构建步骤的段落

## 2. 怎么改

一组一个提交。

**D23 构建脚本从提交取源**

- 不再复制工作区：用 `git -C "$SOURCE" archive "$EXPECTED_COMMIT" | tar -x` 取出基线提交的内容（脚本已经这样取 `memory/`），再套用同一份排除清单。这样被忽略的、未提交的文件都进不来。
- 去掉主目录下那个默认源路径：源路径必须作为参数给出，没给就报错并说明用法。文档里的调用示例同步改。
- 源可以是任何含有基线提交的克隆。验证时**不要用**维护者主目录下那份检出：在 scratchpad 里从 `docs/ga-baseline.md` 记录的上游地址新克隆一份。Rule 1：只读上游内容，绝不往用户自己的 GA 检出里写。

**D22 排除演示媒体、PDF 与测试**

- 构建时排除 `assets/demo` 与那份技术报告 PDF（清单写窄，逐项列出，不用宽泛的 `*.pdf`）；重新跑构建脚本生成 `managed-ga/code/`，确认除了这些文件消失以外与现在逐字节相同（基线 `d66509b` 加补丁栈）。
- 载荷的定义因此从「上游原样加补丁」变成「上游去掉列明的演示媒体加补丁」：在讲代码与补丁的那篇文档、基线文档的升级步骤、清单表头里写明排除清单与理由；`scripts/check-ga-baseline-drift.mjs` 与载荷门禁如果按文件清单或数量核对，跟着改。
- `runner/` 打包时不带 `tests/`：改 `core/tauri.conf.json` 的资源映射（只映射模块文件，或排除 `tests`），确认运行时没有任何地方导入 `runner.tests`。
- 两个门禁脚本补上：载荷里不许出现被排除的路径、上游的定时任务目录、前端临时目录、`*.egg-info`；应用包门禁检查 `managed-ga/` 与 `runner/` 下没有 `.DS_Store`、`__pycache__`、`tests`，并把两个门禁各自手抄的关键文件清单对齐（其中一份缺了另一份有的条目）。

## 3. 验证

```bash
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
.venv/bin/python -B -m pytest -q -p no:cacheprovider          # 测试会导入内置内核
cargo check --manifest-path core/Cargo.toml --workspace       # 构建脚本会校验资源映射
git diff --check main..HEAD
```

打包门禁（`runner/` 与 `managed-ga/` 都变了，必须跑）：在自己的 worktree 里按 `docs/release-update-sop.md` 的打包门禁一节执行。这台机器是 Intel Mac，平台参数是 `mac-x64`，不是文档旧例子里的 `mac-arm64`。

另外贴出：重建前后 `managed-ga/code` 的文件数与体积，以及 `git diff --stat main..HEAD -- managed-ga/code | tail -1`（应当只有删除）。

## 4. 别动什么

- 补丁文件的内容与顺序、基线提交号。
- `managed-ga/state-seed/`。
- `scripts/bundle-python.sh` 的依赖清单与下载逻辑（另一条发现，没有裁决）。
- 维护者主目录下的 GA 检出：不读工作区、不写任何东西。
- `.github/workflows/`（票 04 在改）。

## 5. 回报格式

按 `docs/agents/dispatch.md`。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后 dev 里用内置内核跑一轮带工具调用的任务、一个 IM 渠道收发一条 | 下次发版的包体积比 v0.7.7 小约 22 MB（发版时核对） |

## Comments

**2026-11-10 合入（主会话）**

- `managed-ga/code` 从 27.9 MB 降到 4.8 MB，只删了 8 个文件（演示目录里 7 个，PDF 1 个；票面写的「两张 PNG」不对，是三张），其余逐字节不变。
- 反例：把新克隆切到上游最新提交，放进被忽略的目录、未跟踪文件并改一个源文件，新脚本仍重建出相同的载荷。
- 打包门禁在 `mac-x64` 上通过。没跑真正的 `tauri build`：`runner/*.py` 这条新映射是用 Tauri 构建脚本复制资源的结果加一个模拟应用包验的；Windows 的安装包那条路没有验证。JC 裁定这次不做 `release.yml` 的 dry-run，所以第一次真验证是下次发版的 CI。
- 本机打包更严了：`managed-ga/` 下出现 `.DS_Store` 会让应用包门禁失败（有意，CI 不受影响）。
- 上游自己的 `frontends/tests/`（约 252 KB）仍在载荷里，排除清单要求写窄，没有列它。
- `AGENTS.md` 的 Product Shape 仍写「upstream GA + Galley's patch stack」，没改：排除的只是没有代码读的媒体文件，细节在载荷定义一节。
- 票外没动的：`core/src/managed_runtime.rs` 的 `CRITICAL_MEMORY_SEED_FILES` 是第三份手抄清单，也缺 `ultraplan_sop.md`，而且影响运行时（重置主对话时检查种子是否完整）；关键代码文件清单里没有 Telegram 的前端文件；本机跑 pytest 不设 `GA_PATH` 时导入的是维护者主目录下的 GA 检出，不是仓库里的载荷。
