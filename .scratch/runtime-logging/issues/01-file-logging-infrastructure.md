# 日志基建:core / bridge 日志落盘 + 「打开日志」入口

Status: needs-triage
日期:2026-07-21
来源:Runtime tab 打磨讨论(JC + agent),由 issue #13 远程排障缺口引出

**2026-08-05 已 triage — 结论:暂缓,不排进当前迭代。**
理由:日志对用户体验贡献为零,受益人是维护者而非用户;用户可见的错误路径
(`_emit_error` → IPC → ErrorCard、异常退出 8 行 tail → toast)已经覆盖。
当前阶段在打磨交互体验,优先级排在其后。
触发条件不变(见下),但下方「调研结论」已把开工成本从「两小时重新调研」
压到「半天直接动手」。

## 问题

Galley 已发行给真实用户,但没有可交付的排障日志:

- core(Rust)没有文件日志——`main.rs` / `lib.rs` 无 tracing / env_logger 落盘配置;
- bridge(runner)stderr 只保留内存里 8 行 tail(`core/src/runner_manager/process.rs` `STDERR_TAIL_MAX = 8`),进程退出即丢;
- 唯一写日志文件的是 IM supervisor(`runner/managed_im_supervisor.py` `_redirect_logs`)。

实际痛点:GitHub issue #13(Win11 焦点问题)排障时,**没有任何日志可以问用户要**。下一次 Windows 侧验证 / 回归,同样瞎子摸象。

## 范围(待触发后细化)

值钱的 95% 是基建,UI 是最后 5%:

1. core tracing 落盘(app data 目录下,滚动轮转,大小上限);
2. runner / bridge stderr+stdout 落盘(per-session 或合并,轮转);
3. 日志级别默认克制,不落用户对话内容(Rule 4:数据留在 Galley,也别把对话写进日志);
4. 最后才是 Settings → Runtime 的「打开日志目录」入口(problem domain 匹配:坏了怎么修)。

## 调研结论(2026-08-05,已核实)

触发后不必重新调研,直接照这节动手。

### 迁移规模比预估小得多

- `core/src`:**69 处 `eprintln!`,0 处裸 `println!`**。
- `cli/src`:8 处裸 `println!` + 3 处 `eprintln!`。
- (讨论中一度出现的「214 处」是误统计,把 `core/target/` 里 vendored 的
  managed-ga 源码和 `core/experiments/` 算进去了。)

**69 处的前缀天然就是 tracing 的 target 名**,机械替换即可:
`eprintln!("[socket] …")` → `tracing::info!(target: "socket", …)`。
单行形式 48 处 100% 带 `[subsystem]` 前缀,分布:
`goal` 6 / `socket` 5 / `scheduler` 5 / `backup` 5 / `runner` 4 /
`galley-core` 4 / `discovery` 4 / `codex-oauth` 3 / `backup-recovery` 3 /
`migration-guard` 2 / `im-supervisor` 2 / `auto-title` 2 /
`tray`·`notify`·`db` 各 1。其余 21 处是多行 `eprintln!(` 形式,同文件内
风格一致,需抽查但无意外。

因此**不要**用「启动时 dup2 重定向进程 stderr」的兜底方案。它的全部价值
来自「数量太多迁不动」,而该前提不成立;代价则是真的:轮转时 fd 仍指向旧
文件、Windows 要走 `SetStdHandle` 与 macOS 分叉、丢失级别过滤和结构化字段
(日后想加 `session_id` span 得整个重做)。

### 坑:CLI 的 stdout 是冻结契约

`galley` CLI 的 stdout 是 Rule 3 的 Agent API 输出
(`cli/src/main.rs:91`、`cli/src/session.rs:197`/`234`/`237`)。
而 `tracing_subscriber::fmt()` **默认写 stdout** —— 装上去那一刻就会往 JSON
流里掺日志行,打崩所有下游 agent 的解析。CLI 二进制里必须显式
`.with_writer(std::io::stderr)`。那 8 处 `println!` 一个字都不要动。

### 敏感信息:风险不在对话内容,在继承的 fd 2

bridge stderr 实际流三类东西,风险差一个数量级:

1. **bridge 自己写的**:仅 7 处(`runner/workbench_bridge.py`
   691/694/712/1608/1615/1914/1936),内容为 LLM 名解析失败、
   `generate_title` 失败、GA path not found、startup failed。零对话内容,
   可直接落盘。
2. **Python traceback**:18 处,但全部走 `_emit_error()` 进 IPC JSON 通道
   (带 `category`/`severity`/`context`,直达 GUI ErrorCard),**不进
   stderr**(唯一例外 `:1935` 的 bridge startup failed)。这层已设计好,
   日志系统不需插手。
3. **GA 工具子进程继承的 fd 2**:全部风险在此,内容不可预测(用户脚本可能
   打印 key 或文件内容)。详见 `.scratch/bridge-stderr-fd2/`。

建议方案 —— **分文件,不分级别**:

```text
sessions/<sid>.log       # 只收第 1 类 + 生命周期/退出码 —— 可放心让用户打包发来
sessions/<sid>.raw.log   # 收 fd 2 全量 —— 默认开,「打开日志目录」不默认打包
```

分开的理由是责任归属而非技术:用户主动附上 `raw.log` 是知情选择;自动混进
主日志等于 Galley 替用户决定了他的脚本输出可以外发 —— 后者才是 Rule 4 在
精神上真正被违背处。

**`raw.log` 必须同时带速率 + 单文件大小硬上限,不是 v2 再补的事**:fd 2 今
天是一条无节流通道,落盘等于把「无节流地写一个没人读的 fd」变成「无节流地
写盘」,`code_run` 里一个刷屏脚本就能写满用户磁盘。

### 实施顺序

1. 引入 `tracing` + `tracing-appender`;core 启动时初始化(文件 + stderr
   双 writer),CLI 强制 stderr-only。
2. 机械迁 69 处,前缀映射 target。建议一次迁完 —— 半迁移状态下两套输出并
   存,反而是最难排障的状态。
3. `core/src/runner_manager/process.rs:329` 单独处理:它转发的是**别人**的
   输出,不该套 Galley 的级别语义,直接走独立 writer 接上面的双文件方案。
4. `runner/managed_im_supervisor.py` 的 `wechat.log`(`_redirect_logs`,
   `:163`)补轮转 + 上限,并入统一 logs/ 目录。它是唯一在跑的落盘日志,却
   是唯一无轮转的,长期后台跑会无限增长 —— 这条是纯 bug,可与本 issue 解耦
   提前做。
5. 最后才是 Settings → Runtime 的「打开日志目录」入口。

### 仍未裁决

1. `raw.log` 分不分开(建议分)。
2. fd 2 的速率 / 单文件上限取值。
3. 69 处一次迁完还是先迁 startup 路径(建议一次性)。

## 触发条件

已半触发(#13)。建议在下一次需要远程排障 Windows 问题之前完成 1-2 项。

## 备注

- 敏感信息约束:API key、对话内容、用户路径尽量脱敏。
- Windows 构建验证 #13 修复时,若日志基建已就位,可直接受益。

## Comments

### 2026-08-05 — JC + agent,设计讨论

JC 起意重新评估「Galley 要不要日志系统」,agent 先核实现状(结论:确实没有,
且 `core`/`cli` 无 `tracing`/`log`/`tauri-plugin-log` 依赖;打包 `.app` 双击
启动时 fd 2 无人接管,现有 `eprintln!` 全部丢失),再就敏感信息与迁移成本两
点展开,产出上方「调研结论」。

JC 的裁决:**暂缓**。理由是日志对用户体验贡献为零,受益人是维护者;当前阶
段应继续打磨交互体验。agent 同意该判断,并记录一条保留意见:

> 触发条件是事件驱动的 —— 问题真出现那天,会第二次站在「没有任何日志可以
> 问用户要」的位置,而那时现补来不及(用户已在等)。#13 是第一次。

据此决定不实施、但把调研沉淀进本文件,使下次触发时是「半天开工」而非「重新
调研两小时再开工」。

讨论中另有一项与日志解耦的独立发现(bridge 管了 fd 1 未管 fd 2),已单开
`.scratch/bridge-stderr-fd2/`,避免与本 issue 绑死后一并被推迟。
