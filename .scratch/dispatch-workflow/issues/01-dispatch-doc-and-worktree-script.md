# 01 派单文档与 worktree 脚本

Status: done（2026-11-10 合入，无真机步骤）

来源：2026-11-10 JC 裁决（五点全按推荐）：分工法转正、规则搬进仓库、派活必传 `model`、票面加第六项、不加审查代理也不加更便宜的执行档。

## 背景

「主会话讨论与验收、Opus 子代理在 worktree 里执行、验收后合入 main」这套分工从 2026-09-23 试到现在，规则只有一段概述在 `docs/session-close-sop.md` 的「Main Sessions With Background Agents」一节，细则和派单的坑散在主会话的私有记忆里。本票把它们落成一份仓库文档和一个建 worktree 的脚本，以后派单的 brief 只写「先读 `docs/agents/dispatch.md`」。

## 1. 改哪些文件

- 新增 `docs/agents/dispatch.md`（英文，与 `docs/agents/` 其余文件一致）
- 新增 `scripts/new-ticket-worktree.sh`
- `docs/session-close-sop.md`：「Main Sessions With Background Agents」一节加一句指向新文档的链接，别的不动
- `docs/README.md`：路由表在「Track issues / PRDs…」那一行后面加一行
- `AGENTS.md`：「Agent skills」下、「Triage labels」与「Domain docs」之间加一小节 `### Dispatch`，两三行加链接（`CLAUDE.md` 是它的符号链接，只改 `AGENTS.md`）

## 2. 怎么改

### 2.1 `docs/agents/dispatch.md`

目标 150 行以内，写规则不写历史（不写日期流水、不写票号案例）。下面是要写进去的全部规则，按这个分节，措辞你来定，规则本身不要增删；觉得哪条有问题写进回报。

**Roles**

- 主会话：讨论、写票、派单、验收、合入、提交。执行代理：后台跑，一票一个 worktree。
- 一次一个主会话；并开时在途上限共用。

**Models and effort**

- 每次调用 Agent 都显式传 `model` 和 `effort`。省略 `model` 会继承父模型，主会话是更贵的模型时等于拿它去读文件、跑门禁；核对事实用的只读代理（Explore）也一样要传。
- 执行代理用 `model: "opus"`。
- 强度三档：`high` 给机械票（文案已逐字写死的 locale 改动、文档同步、按清单替换、补测试、只跑门禁）；`xhigh` 是默认（逻辑、跨层、契约、并发时序）；`max` 只给在 `xhigh` 卡住过一次的疑难诊断。
- fork 永远跑父模型，只留给上下文多到写不进票面的探索或原型。
- 不设独立审查代理，不设比 Opus 更便宜的执行档。

**Limits**

- 在途约 3 张；等用户真机验收的不超过 2 张；同时编译 Rust 的票 1～2 张。
- 瓶颈是用户的真机验收，不是执行；队伍满了先清验收再派新票。

**What the main session does itself**

- 单文件、几行、不用读第二个文件的改动自己做。
- 没有讨论在进行时，2～3 个文件的小改也可以直接做（限制的理由是挡住讨论）。
- 其余一律派。

**Ticket**

票面六项，要自足（执行代理看不到对话）：

1. 改哪些文件
2. 怎么改
3. 验证命令
4. 别动什么
5. 回报格式
6. 真机步骤，分两栏：主会话能代验的（CLI、数据库、日志、dev 探针）与只能用户验的（手感、气质、观感）

写票的注意：

- 并行票共用的接口契约、文案定稿逐字写进每张票。
- 写「保留 X，它还有别的调用方」之前，逐个核对调用方不在待删代码里。
- 规则写成「凡是出现…」时，列明不覆盖的边界。
- 评测票写死用哪个模型。
- 票面和 Comments 不写本机路径、私有接口地址、用户的真实数据（本仓库开源）。

**Worktree**

- 用 `scripts/new-ticket-worktree.sh` 建，从本地 `main` 起分支。
- 不用 Agent 工具内置的 `isolation: "worktree"`：它从 `origin/main` 起分支，本地已提交未推送的票和裁决不在里面。
- 执行代理只在自己的 worktree 里动，不碰主工作树，不跑 `tauri dev`。
- 目录不重叠的并行票可以共用一个 worktree；共用时只让一个代理编译 Rust。

**Standing constraints for executor agents**（主会话派单时不用再抄，brief 指到这一节）

- 在票的分支上提交，点名文件，不用 `git add -A` / `git commit -a`；不 push，不合入。
- 长命令在前台跑。不要留后台等待循环；非等不可就对进程号等（`while kill -0 <pid>; do sleep 5; done`），不要 `pgrep -f`（会匹配到循环自己）。
- 临时文件放 scratchpad，文件名带票号前缀。
- 只格式化自己改的地方：`gui/` 的旧文件只管自己的 hunk，`core/` 用 `rustfmt --check` 逐文件看，不跑 `cargo fmt --all`。
- 票面前提不对、看到了但不在票内的问题：写进回报，不自己扩范围。
- 回报四段：改了什么（文件与提交号）；验证命令与输出；Open risks / 没验证到的；票外发现。

**Acceptance**（主会话）

- 读 `git diff main...<branch>`，结构性票逐 hunk 看；信输出不信报告。
- 门禁在没有代理正在改的 worktree 上跑。
- 并行票专门走一遍两票动作串起来的那条路径。
- 布局与动效票交给用户前，先在真窗口里量（jsdom 不排版）。
- 代理报的 Open risks 逐条处理或原样转达，不压掉。
- 查一遍代理留下的等待循环并清掉。

**Merge**

- 合入前最后一刻在 worktree 里 `git rebase main`，`git diff --name-only main..HEAD` 只含本票文件，再在主工作树 `git merge --ff-only`。
- 只改 `gui/` 的票：dev 只做热更，挑用户两步之间合。
- 改 `core/`、`cli/`、`runner/` 的票：合入会让 dev 重启 Core，先用 `core/target/debug/galley status` 确认 `live.busy` 为 0。
- 合入后删 worktree 和分支，票的 `Status:` 改成 `needs-dogfood` 或 `done`（链到 `triage-labels.md`）。

**While tickets are in flight**

- 查进展看 worktree 的 `git log --oneline main..HEAD` 和 `git status`，不读代理的转录。
- 关联票用 SendMessage 交给同一个代理续做（上下文还在），先让它 rebase 到新的 `main`。
- 有新裁决就当场核对在途票，受影响的改票或停掉重派。
- 在途看板（票、代理、worktree、状态、在等谁）放 scratchpad，不进仓库。

### 2.2 `scripts/new-ticket-worktree.sh`

用法：`scripts/new-ticket-worktree.sh <name> [--rust] [--dir <parent>]`

- `<name>`：票的短名（如 `152` 或 `dispatch-01`）。分支 `ticket/<name>`，worktree 路径 `<parent>/<主工作树目录名>-wt-<name>`。
- `<parent>` 默认是主工作树的上一级目录。
- 「主工作树」取 `git worktree list --porcelain` 的第一项，脚本从任何 worktree 里调用结果都一样；分支从本地 `main` 起。
- 分支或目录已存在就报错退出，不覆盖。
- 总是跑 `pnpm --dir <wt>/gui install --frozen-lockfile`。
- `--rust`：从主工作树克隆 `core/target/debug`、`core/target/tauri-sidecars`、`core/python-bundle`、`core/gen` 到 worktree 的对应位置，然后删掉 `core/target/debug/incremental`。克隆用 `cp -cR`（APFS clonefile，不占空间）；非 macOS 上打印一句「跳过克隆，首次编译是全量」后继续。某个源目录不存在就跳过并说明，不报错。
- 结束时打印 worktree 路径、分支名、删除用的两条命令。
- 风格照 `scripts/` 里现有的 `.sh`（先看 `prepare-cli-sidecar.sh`）：`set -euo pipefail`，可执行位。

`core/target` 很大（几十 G），克隆要几十秒，属正常。

## 3. 验证

- `bash -n scripts/new-ticket-worktree.sh`；本机有 `shellcheck` 就跑。
- 真跑一遍：`scripts/new-ticket-worktree.sh t01-probe --rust --dir <你的 scratchpad>`，然后在建出来的 worktree 里：
  - `cargo check --manifest-path core/Cargo.toml --workspace` 通过，且不是全量编译（记下耗时）
  - `pnpm --dir gui typecheck` 通过
- 再跑一次同名，确认报错退出、不动已有目录。
- 按脚本打印的命令删掉探针 worktree 和分支，`git worktree list` 与 `git branch --list 'ticket/*'` 里都不再有它。带着克隆出来的被忽略目录时 `git worktree remove` 是否需要 `--force`，以实测为准，脚本打印的命令和文档写实测能用的那条。
- `node scripts/check-docs-links.mjs` 通过。
- `git diff --check` 干净。

## 4. 别动什么

- 不碰主工作树（主工作树常驻 `tauri dev`）；只在本票的 worktree 里改。
- `docs/session-close-sop.md` 除那一句链接外不动。
- 不改 `core/`、`gui/`、`runner/`、`cli/` 下任何文件。
- 文档里不出现本机绝对路径、用户名。
- 不 push，不合入。

## 5. 回报格式

四段：改了什么（文件与提交号，提交号抄命令输出）；验证命令与关键输出（含 `cargo check` 耗时、`git worktree remove` 实测用的命令）；Open risks / 没验证到的；票外发现（包括你认为上面哪条规则写得有问题）。

## 6. 真机步骤

- 主会话代验：读文档对照本票规则清单；自己再跑一遍脚本建、删 worktree。
- 用户验：无。

## Comments

- 2026-11-10 合入。执行代理实测：`git worktree remove` 带着克隆出来的被忽略目录时不需要 `--force`。
- `--rust` 克隆 `core/target/debug` 的收益比原先以为的小。主工作树当时只有 `tauri dev` 留下的 build 产物：`cargo check --workspace` 克隆后 1 分 27 秒、空目录 1 分 33 秒；`cargo test --workspace --no-run` 克隆后 2 分 33 秒（重编 68 个 crate）、空目录 3 分 06 秒（405 个）。脚本保留克隆（不占空间，另外三个目录是构建必需的输入），帮助文字与文档按实测写。
- 验收时主会话补了三处：共用 worktree 时同一分支、整组一起验收合入；放弃的分支用 `git branch -D`；Agent 调用的描述以票名开头（配合子代理状态行）。
- 没验证到的：非 macOS 上跳过克隆的分支没有实测；本机没装 `shellcheck`。
