# 02 行为修复：搜索索引、错误提示的死分支、吞掉的写失败、写死的中文

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 A1、A5、A7、A8（JC：「按建议推进」）。A6（⌘K 的「Enter 直接发问？」）不在本票：派单前发现设计文档把它定为要做的功能，退回 JC 重新裁决。

先读 `docs/agents/dispatch.md`、`docs/engineering-workflow.md`、`docs/copy-language-guidelines.md`、`docs/copy-austerity-principles.md`。行号是 `79403d1e` 时的，以符号名为准。

## 1. 改哪些文件

- A1：`core/src/db/search.rs`、`core/src/db/helpers.rs`、`core/src/db/session.rs` 及 `core/tests/` 里对应的测试；`gui/src/lib/db.ts` 里描述索引规则的注释
- A5：`gui/src/components/error-card/`、`gui/src/components/overlay/ToastHost.tsx`、两份 locale、`gui/src/types/ipc.ts` 的注释、`docs/design/` 里错误卡片那一节
- A7：`gui/src/stores/sessions/{archive-slice,lifecycle-slice,project-slice}.ts`、`gui/src/components/screens/project/EditProjectDialog.tsx` 及测试
- A8：`gui/src/stores/runtime/bridge-slice.ts`、`gui/src/stores/browser-control.ts`、`gui/src/components/screens/settings/browser-control-view.ts`、两份 locale

## 2. 怎么改

一组一个提交。

**A1 搜索索引一条规则**

现状：`backfill_fts_if_empty` 用 `FTS_SOURCE_FILTER` 数「该有多少行」，助理行的正文取 `COALESCE(final_answer, content)`；实时写入（`session.rs` 里写助理行与说给用户的那一行之后）只在 `final_answer` 非空时索引。于是每个只有工具调用的步骤、每条静默回复都被计数却不被索引，`fts_cnt < msg_cnt` 几乎恒成立，GUI 每次启动与重载（`gui/src/lib/hydrate.ts` 调用）都清空并重建整张索引，重建时还把这些行的原始 `content`（带 `<summary>` 等标签）灌了进去。

改成一条规则，三处共用：
- 助理行：只索引非空的 `final_answer`。用户行：只索引非空的 `content`（只有图片的消息不进索引）。其余角色与不可见的行不进索引。
- 把规则放进一个共享的 SQL 片段或常量，计数、重建的 `SELECT`、`write_message_row` 都用它；`index_message_fts` 的调用方保持一致。
- **已有的库要重建一次**：现有索引里有大量按旧规则灌进去的行，而新规则下 `fts_cnt >= msg_cnt` 会让回填直接返回，旧行永远留着。用一个 prefs 标记（比如索引规则版本号）让它在升级后的第一次回填时强制重建一次并写下标记；`fts_cnt < msg_cnt` 仍然作为崩溃恢复的触发条件。不加迁移文件。
- 测试：只有工具调用的步骤加一条静默回复加一条只有图片的用户消息，回填返回 0；带旧标记（或没有标记）的库重建一次，第二次返回 0；重建后搜不到 `<summary>` 这类标签文本。
- 把 `gui/src/lib/db.ts` 里描述索引规则的注释对齐到新规则。

**A5 错误提示：删掉从未接线的分支**

错误卡片现在只在 toast 宿主里渲染，宿主从不传「重试 / 切换模型 / 打开 mykey.py / GA 文档」这些处理函数，详情开关也没加到任何卡片上（自 `8ee9f056` 起）。删掉：这四个处理函数的 props 与分支、详情开关与详情面板、没有调用方的 `inline` / `card` 变体、因此无人引用的 locale key。设计文档里错误卡片那一节与 `gui/src/types/ipc.ts` 里承诺这些按钮的注释改成现状（只有 toast）。提示正文（比如额度不足时的「可切换其他模型继续」）不动。

每删一个变体或 key，先在 `gui/src` 全目录 grep，含测试与模板字符串拼出的 key。

**A7 写失败不再报成功**

`archive-slice.ts`（归档、取消归档、批量）、`lifecycle-slice.ts`（改名、置顶、推理强度）、`project-slice.ts`（建、改、删项目，把会话移进项目）都是先改内存、Core 调用失败只 `console.debug`。同文件里做对了的样板：`createSessionPersisted` 的回滚、删除会话的错误提示。
- 调用失败时把内存里的那一行恢复原状（或按 Core 的返回重读），并弹现成的错误提示；成功提示改到调用成功之后再弹。
- `updateProject`、`createProject` 失败时向上抛，让 `EditProjectDialog` 已有的 `catch`（对话框留在原地、保存按钮恢复）真的能走到；`App.tsx` 里建完项目接着移会话的那段，建失败就不移。
- 不新增文案：用现成的错误提示 key。找不到合适的现成 key 就写进回报，不要自己造。
- 每个动作补一条「Core 拒绝时内存回滚且不弹成功」的 vitest。

**A8 两处写死的中文**

- `bridge-slice.ts` 的 `onClose`：`"Galley 运行时意外退出，未返回退出码。"` 与 `` `Bridge exited with code ${code}` ``。改成 locale key。
- 浏览器桥：`core/src/browser_bridge.rs`、`core/src/browser_control.rs` 的错误详情是中文句子，界面原样显示。**不改 Core**：界面按已有的错误类型字段出文案，Core 给的句子只在没有对应类型时作为详情兜底。
- 这是新文案，要 JC 确认：按文案规范（内核 / engine 的叫法、克制原则）起草中英两版，先用起草稿实现，并在回报里列一张表（key、中文、英文、出现的场景）。主会话拿去给 JC 过目，可能要改字。

## 3. 验证

```bash
cargo check --manifest-path core/Cargo.toml --workspace --all-targets
cargo test  --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
TZ=UTC pnpm --dir gui test
node scripts/check-docs-links.mjs
node scripts/check-ipc-protocol-drift.mjs
git diff --check main..HEAD
```

中文新增行用全角标点；写个小脚本扫自己新增的行，输出贴进回报。`gui/` 里只格式化自己的 hunk，Rust 文件逐个 `rustfmt --check`。

## 4. 别动什么

- `index_message_fts` 里先删后插的那条 `DELETE`（另一条性能发现，没有裁决）。
- 任何迁移文件、Agent API、IPC 字段。
- 错误提示的正文文案、toast 的样式与时长。
- `core/src/browser_bridge.rs`、`core/src/browser_control.rs` 的错误句子。
- ⌘K 命令面板，包括「Enter 直接发问？」那个按钮与 `onSubmitFreeText`（等 JC 裁决）；不加任何新的界面元素。
- `DEFAULT_LLMS` 等默认值、GUI 侧的 runner 淘汰、实时窗口的离场计时。

## 5. 回报格式

按 `docs/agents/dispatch.md`，外加 A8 的文案表。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后查库：重启一次 dev，索引行数降到「非空最终回答加非空用户消息」的数；再重启一次行数不变（不再重建） | 归档一个会话、改一次项目名，照常成功 |
| ⌘K 搜一个只出现在工具步骤原文里的标签名，应无结果 | 英文界面下的 A8 文案（确认稿） |

## Comments
