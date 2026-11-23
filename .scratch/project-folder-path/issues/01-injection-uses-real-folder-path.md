# 01 项目模式注入改用真实文件夹路径

Status: needs-dogfood（2026-11-23 合入 main，a4e63f72；等 Windows 真机）
日期：2026-11-23
背景：[PRD](../PRD.md)（问题、根因、裁决、边界）。先读 [dispatch](../../../docs/agents/dispatch.md) 与
[code-state-and-patches](../../../docs/managed-ga-runtime/code-state-and-patches.md) 的「How To Add A Patch」。

## 要的行为

内置内核、项目绑了文件夹的会话里，每轮追加到用户消息末尾的项目模式段落：

1. 出现的目录与记忆文件路径是**用户选的真实文件夹**（例如 `D:\work\demo`），不是状态目录下的链接路径。
2. 明说用户口中的「工作目录」「项目文件夹」「项目目录」就是它，找文件先在这里找，对用户说路径时用它。
3. 明说状态目录下那个同名目录是链接，不是副本，不要清理或删除。

没有绑文件夹的项目模式（用户口头「进入某某项目」，上游 SOP 那条路，目录是 `temp/projects/<项目名>` 下的真实目录）注入内容
**逐字节不变**。

## 1. 要改的文件

- `managed-ga/code/plugins/project_mode.py`：只通过补丁改。新补丁用下一个编号（现在最大的是 `0035`），文件名
  `0036-managed-project-folder-real-path.patch`，零上下文 unified diff。
- `managed-ga/manifest.json`（`patchStack.patches` 末尾加文件名）、`managed-ga/patches/manifest.md`（加一行：原因、涉及的上游
  文件、rebase 风险、移除条件）。`project_mode.py` 已被 `0001` 改过（状态根那几行），新补丁排在它后面，在 rebase 风险里写明。
- 新测试文件 `runner/tests/test_managed_ga_project_mode.py`。
- 文档：全仓 grep 一遍对补丁清单、补丁数量、项目模式注入内容的镜像（`docs/`、测试、脚本），有就同步；没有就不加新文档。
  devlog 与 deferred 由主会话写，不要动。

## 2. 怎么改

### 2.1 取真实路径

`inject_project_context(ctx)` 里已经能拿到 `handler.parent`（`_active_project` 的取法）。同样从它读
`_ga_project_mode_workspace_path`（Galley 的 runner 在 `set_project_mode` 里设，上游 TUI 也设同名属性），传给
`_build_injection`。

### 2.2 何时用真实路径（确定规则）

同时满足才用，否则走原来的写法：

- 属性是非空字符串；
- `os.path.samefile(<链接路径>, <属性值>)` 为真（链接路径即现有的 `_project_dir(name)`）。任何 `OSError` / `ValueError` 当作不满足。

第二条挡的是这种情况：会话绑着文件夹 A，用户口头让模型 `handler.enter_project_mode('别的项目')`，名字换了而属性还是 A。
这时必须回到原来的写法，不能把 A 的路径配给别的项目。

### 2.3 注入内容（终稿，逐字）

满足 2.2 时，「## 规则」下面原来的第一条换成下面两条，其余结构不动。`{workspace}` 是属性值（`os.path.abspath` 后），
`{pdir}` 是链接路径：

```
- 项目文件夹：{workspace}。这是用户为本项目选的文件夹，用户说的「工作目录」「项目文件夹」「项目目录」指的就是它：用户提到的文件先在这里找；todo、草稿、产物一律放这里（勿放 temp 根目录）；对用户说路径时用这个路径。
- {pdir} 是指向这个文件夹的链接，不是副本，不要清理或删除它。
```

同时，记忆提示（`mem_hint` 的两种写法）和「收尾纪律」里出现的记忆文件路径，改成
`os.path.join(workspace, 'project_memory.md')`。行数、字节数照旧统计（读哪个路径都是同一份文件）。

不变的东西：

- `[PROJECT MODE: {name}]` 这一行和「你正在「{name}」项目模式中。」原样保留。`workspace_cmd.workspace_from_log` 靠这个标记认会话。
- 不满足 2.2 时，整段输出与补丁前逐字节相同。
- 字符串与多模态列表两条追加路径都走同一段文字。

### 2.4 测试

`runner/tests/test_managed_ga_project_mode.py`，从 `managed-ga/code` 加载插件。照
`runner/tests/test_managed_ga_llmcore.py` 开头的做法关掉字节码写入（否则 `managed-ga/code` 下留 `__pycache__`，
`check-managed-ga-payload` 会报）。插件的状态根在 import 时从 `GALLEY_GA_STATE_ROOT` 读，测试要用临时目录，注意别影响同进程里
其他测试已经加载的模块。

至少覆盖：

1. 没有属性：输出含原来的「项目私域目录：<链接路径>」一条，不含「项目文件夹：」。
2. 有属性且链接指向它：输出含 2.3 的两条（真实路径、链接路径各在其位），记忆文件路径在真实文件夹下，`[PROJECT MODE: <名字>]` 还在，
   不含「项目私域目录」。
3. 有属性但与链接不是同一目录（名字被换成别的项目）：与情况 1 相同的写法。
4. 有属性但链接不存在：与情况 1 相同的写法，不抛异常。
5. 多模态列表内容：追加的 text block 与字符串路径的文字相同。

链接用 `frontends/workspace_cmd.py` 的 `make_dir_link` 或 `prepare` 建，这样 Windows 上走的是目录联接（不需要管理员权限），
与真实情况一致。先看 `.github/workflows/check.yml` 里 runner 测试在哪些平台跑，测试要在那些平台都能过（Windows 检出是 CRLF，
断言别跨行比对源文件内容）。

## 3. 验证命令

```bash
# 补丁栈能从上游基线重放出当前 payload（<clone> 是 upstream.source 的全新克隆，放 scratchpad）
scripts/build-managed-ga.sh <clone> && git status --short   # 重放后工作树应无多余改动
node scripts/check-managed-ga-payload.mjs
<python> -m pytest                      # 全量单测
<python> -m pytest runner/tests/test_managed_ga_project_mode.py -v
TZ=UTC <python> -m pytest runner/tests/test_managed_ga_project_mode.py
<python> -m mypy runner
<ruff> check runner
git diff --check
```

另外自写一个正则，扫本票 diff 新增行里中文语境下的半角标点（逗号、冒号、括号、分号），报告里贴结果。注入终稿里的标点以
2.3 为准。

## 4. 不要碰

- `managed-ga/state-seed/`（种子记忆，含 `project_mode_sop.md`）。
- `frontends/workspace_cmd.py`、`ga.py`、系统提示词里的 `cwd` 一句、`handler.cwd`。
- `runner/` 下除新测试以外的文件。真实路径已经由 `set_project_mode` 设好，runner 不用改。
- GUI 文案、`core/`、`cli/`。
- 不给上游提 PR / issue。

## 5. 报告格式

按 dispatch 的四部分：改了什么（文件与提交号，提交号抄命令输出）；验证命令与输出；未解决的风险 / 没验证到的；票外发现。
另加一段：补丁后两种情况下注入段落的完整原文各一份（用虚构路径）。

## 6. 真机步骤

| 主会话代验 | 只能 JC 验 |
|---|---|
| macOS dev：用 CLI 建一个绑文件夹的项目和会话，文件夹里放一个文件，发「工作目录下有个某某文件，读取并说说它是做什么的，再在工作目录里写一份摘要」。查库：第一步工具调用读的是不是真实文件夹下的路径（不是先查 temp）；回答里报的路径是不是真实路径；摘要文件落在真实文件夹里。测完永久删除测试会话与项目。 | Windows 真机（目录联接、反斜杠路径、盘符与状态目录不同盘）：发版冒烟时走同一句话。 |

## Comments

### 2026-11-23 验收（主会话）

- 读过 `git diff main...ticket/project-folder-01`；在 worktree 里重跑门禁：补丁栈重放后工作树干净，`pytest` 902 过，新测试 17 过
  （`TZ=UTC` 同），`mypy`、`ruff`、`check-managed-ga-payload`、`git diff --check` 过。
- macOS dev 代验（`gpt-6.2-sol`，同一个临时项目、票第 6 节那句话，各一轮）：
  - 补丁后：第一步直接读真实文件夹下的文件，共 4 步；摘要写在真实文件夹里；回答报的是真实路径。引擎日志确认收到的是新写法。
  - 补丁前的写法（临时换回、跑完还原）：第一步按相对路径在 temp 读，没读到，再跑代码列目录找，共 7 步；回答报的是状态目录下的
    链接路径。复现了 issue 的两个现象。
  - 两个测试会话、临时项目、状态目录里的链接与注册表条目已删除。
- 执行代理报的未解决风险，原样：
  - Windows 没验：目录联接、`samefile` 在状态目录与文件夹不同盘时的表现、反斜杠路径，都没在真机上跑过。CI 的 runner 测试只在
    ubuntu 跑。
  - 属性名被上游改掉时不会报错，注入会静默回到旧写法（已写进补丁清单与 GA baseline 耦合点 27）。
  - 一个按规则会出错的边角：属性值恰好就是 `temp/projects/<名字>` 这个真实目录本身（不是链接）时，`samefile` 为真，注入会说它是
    链接。走 `prepare` 到不了这一步（`validate_path` 拒绝 temp 内的路径），规则本身没挡。
- 票外发现：删掉项目后，状态目录里的链接和注册表条目留着（JC 同日裁先不动，已进 deferred）。

### 2026-11-23 发版后

- 随 v0.7.12 发出。打包版上 S2 过（临时项目绑文件夹，第一步读真实文件夹，回答报真实路径）。Windows 清单「Project folder」三项
  仍没人走，本票停在 `needs-dogfood`。
- JC 裁：2.2 的 `samefile` 规则留。issue #34 已回帖，等对方更新后的回报。
