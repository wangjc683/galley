# 2026-11-10 全仓审计：待办裁决与工单

来源：2026-11-10 JC 要求「读全仓，找出损坏、不一致、低效、不再需要的东西，修确信的，其余列出」。十个只读审计代理分片读完全仓，共 169 条发现。

## 已经合入的部分

确信的修复当天合入 `main`（`24c82a6f` … `9621f326`，随后 `d245eeb3` 更新 `docs/project-status.md`）。内容见 `docs/project-status.md` 的「Unreleased On Main」。合入前门禁全过；合入后核过 Core 重启、四个 IM 渠道与浏览器桥进程起来；界面没有走真机。

## 28 条裁决

2026-11-10 JC：「按建议推进」，下表的结论即主会话的建议。编号沿用当时给 JC 的清单。

| 编号 | 发现 | 结论 | 票 |
|---|---|---|---|
| A1 | 搜索索引的回填规则与实时写入不一致，几乎每次启动全量重建，索引里有工具步骤原文 | 做：三处统一成一条规则 | 02 |
| A2 | `project follow --until-idle` 用 Core 从不写的状态值判空闲，会在子会话还在跑时退出 | 做：改读实时运行状态 | 01 |
| A3 | `session watch` / `follow` 把 runner 安静 120 秒当成 Core 无响应 | 做：只改 CLI，线上协议不变 | 01 |
| A4 | Windows 安装前钩子匹配 `Galley.exe`，主程序是 `galley-core.exe` | 做：等 Windows 真机验 | 04 |
| A5 | 错误提示的重试、切换模型等按钮从未接线 | 删掉死分支，设计文档改成现状 | 02 |
| A6 | ⌘K 的「Enter 直接发问？」是没接线的桩，会丢输入 | 按设计接线：回车开新对话并把输入当第一句。主会话最初建议「删」，派单前发现 `docs/design/overlays-and-settings.md` 的命令面板一节把它定为要做的功能，退回后 JC 当天改裁 | 08 |
| A7 | 归档、改名、项目写操作失败时照样提示成功 | 做：回滚并提示 | 02 |
| A8 | runner 意外退出、浏览器桥错误两处写死中文 | 做（文案 JC 已确认；浏览器桥已知类型的诊断原文不再显示，JC：「先这样」，已进 deferred） | 02 |
| B9 | 文档要求校验 IPC `protocolVersion`，无人校验 | 改文档，不加校验 | 03 |
| B10 | 用 `--schema=1` / `2` 请求时帧里永远写 3 | 做：回显请求的版本 | 01 |
| B11 | `tool_call_*` 三个事件无发射方，公开示例里有 | 文档改，代码随 C14 删 | 03 |
| B12 | Supervisor SOP 与参考文档三处过时 | 做（文字 JC 已过目） | 05 |
| B13 | `docs/temperament.md` 拒绝清单被产品推翻 | 气泡那一条按裁决改写（JC 已过目）；「不 toast」「不设保存按钮」两条查无推翻它们的裁决，原意比审计转述的窄，JC：「暂不用」改 | 05 |
| C14 | Goal 遗留的三个 socket 命令与写入侧 `visibility` | 删 | 03 |
| C15 | `core/experiments/` 与 `experiments` feature | 删 | 03 |
| C16 | `docs/galley-native/` 已于 2026-06-17 放弃，仍被索引为在途 | 归档 | 05 |
| C17 | 每次启动都跑的 v0.1 演示会话清理 | 删 | 03 |
| C18 | CI 仍用 `prepare-cli-sidecar.sh`；`release.yml` 有一步没人用的 Setup Python | 做：统一到 `.mjs` | 04 |
| C19 | 根目录与 `gui` 的 `format` 脚本整仓格式化 | 删 | 04 |
| D20 | 开源卫生：历史里的本机路径、测试夹具里的家目录、私有仓名、手册里的真实待办例子 | 历史不改写；其余做 | 06 |
| D21 | `.scratch` 评测输出占已跟踪树约六成 | 停止跟踪原始 `results.json`，留 `results.md` | 05 |
| D22 | 安装包里约 22 MB 上游演示媒体与 `runner/tests` | 做：构建时排除 | 07 |
| D23 | `build-managed-ga.sh` 默认从维护者自己的检出复制，看不见被忽略的文件 | 做：从指定提交取源，源路径必填 | 07 |
| D24 | 四个未跟踪的 `release-v0.7.0` 结果文件 | 已移到仓库外（2026-11-10，主会话） | — |
| E25 | `docs/PRD.md` 多处过时 | 小修加横幅；全面重写暂缓 | 05 |
| E26 | `docs/project-status.md`、`docs/design/conversation.md` 超过约 1,000 行的拆分线 | 做 | 05 |
| E27 | README 与截图停在 v0.7.1 之前 | 文字现在改（JC 已过目）；截图暂缓到下次发版前 | 05 |
| E28 | `docs/release-workflow.md` 的手动兜底流程照着跑不通 | 删，留说明 | 05 |

**不做**：改写 git 历史（D20、D21 都涉及）。泄露的是临时路径里的登录名与一个私有仓名，敏感度低；改写公开仓库的历史会让所有克隆与 release tag 对不上。

**暂缓**（启动信号）：
- `docs/PRD.md` 全面重写：下次 minor，或要对外介绍产品时。
- README 截图重拍：下次发版前，与发版一起做。
- A4 的 Windows 真机验证：下次发版的 W1。

## 没列进 28 条的发现

约 60 条较小的发现没有逐条裁决：未实测的性能疑点（主区每个流式 chunk 重渲整段对话、文件路径引用上的 Radix 根、`index_message_fts` 的全表删除）、仅文件内使用的导出、IM 渠道两条时序疑点（完成报告超 300 秒被丢、Telegram 的忙碌判断与其余三个渠道不同）、GUI 与 Core 各有一套 runner 淘汰、淘汰时新 runner 的 `ready` 可能被 GUI 错过、中继没有准入控制（部署前要定）。要做其中哪条，另开票。

## 票

| 票 | 内容 |
|---|---|
| [01](./issues/01-cli-contract.md) | CLI 契约：A2、A3、B10 |
| [02](./issues/02-behavior-fixes.md) | 行为修复：A1、A5、A7、A8 |
| [03](./issues/03-ipc-slimming.md) | 瘦身：B9、B11、C14、C15、C17 |
| [04](./issues/04-build-plumbing.md) | 构建管道：A4、C18、C19 |
| [05](./issues/05-docs.md) | 文档：B12、B13、C16、D21、E25–E28 |
| [06](./issues/06-hygiene.md) | 开源卫生：D20 |
| [07](./issues/07-payload-slimming.md) | 内置内核载荷：D22、D23 |
| [08](./issues/08-palette-ask-directly.md) | ⌘K「Enter 直接发问？」接线：A6 |

第一波 01、02、04、05 与 08 已于 2026-11-10 合入；第二波 03、06、07 同日派出。
