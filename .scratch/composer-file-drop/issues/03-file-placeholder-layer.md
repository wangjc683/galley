# 03: 文件路径占位符——插入、registry、提交时展开

Status: done（2026-07-29 实现完成；typecheck/lint/vitest 全过，纯函数层
11 个新用例。实现：`lib/composer-file-ref.ts` + `hooks/useFileReferences.ts`，
结构镜像 paste-fold；展开经 Composer 的 `expandComposerPlaceholders` 统一
覆盖提交 / Goal / draft 写通三路。展开采用"registry 精确串匹配"，比
paste-fold 更严——占位符内任何手改都视为放弃展开。draft 按既有约定存展开
后文本，registry 无需跨挂载存活。）
Blocked by: 02

（纯函数层不依赖 02，可并行先做并单测；最终接线依赖 02 的非图片分流挂钩。）

## 范围

仿照 `lib/composer-paste.ts` + `hooks/usePasteFold.ts` 的成对结构：

- 纯函数层（如 `lib/composer-file-ref.ts`）：
  - 占位符格式：`[File #N: name.ext]` / `[Folder #N: name]`，固定英文
    （locale 无关，理由同 paste-fold）；`#N` 计数器区分同名。
  - 光标处插入（复用/泛化 `foldPastedText` 的 splice + caret 数学）；
    多文件空格分隔。
  - 展开：绝对路径，含空白字符加双引号，否则裸路径；Windows 反斜杠原样。
  - 继承「手动编辑优先」：mangled 占位符不展开，unknown id 原样保留。
- 状态层（hook）：registry 管理、post-commit caret 恢复（照抄
  `usePasteFold` 的 `pendingCursorRef` 模式）、与 02 的非图片路径分流对接。
- 提交展开：在 `expandPastePlaceholders` 同一位置串接文件占位符展开，
  覆盖 `sendUserMessage` 与 `submitFromEmpty`（EmptyState）两条路径。
- draft park/restore（`lib/composer-draft.ts`）：registry 随草稿存活，
  跨 session 切换不丢。

## 验证

- 纯函数层单测：格式、同名计数、引号规则、多文件、mangled/unknown 边界。
- `/btw` 前缀判定在含占位符文本上仍正确（加用例）。
- 手工：拖非图片文件/文件夹 → 占位符 → 发送 → 消息气泡显示完整路径；
  混拖（图片+文件）各走各的。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`。
