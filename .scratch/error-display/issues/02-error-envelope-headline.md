# 02 工具错误信封解析 + headline + 折叠详情

Status: ready-for-human

## 范围

纯 GUI render 层（PRD 定案 1），不动 runner、不动 IPC。核心触点：

- `gui/src/lib/tool-outcome.ts` — `{"status":"error"}` 信封识别，
  作为与 denied 同级的 documented coupling point（PRD 定案 3）
- `gui/src/lib/agent-turn.ts:80` `previewFromContent` — 现为头部 500
  字符截断，traceback 异常行在末尾被截掉
- `gui/src/components/conversation/ToolCallout.tsx` ResultBlock —
  已是 monospace pre，问题在带内转义

## 内容

1. 对工具结果内容尝试识别 `{"status":"error", ...}` 信封（JSON parse +
   字段精确检查；parse 失败或形状不符 → 维持现状渲染，绝不误标）。
2. 命中信封时解出 stdout/stderr（JSON.parse 即完成 `\r\n` / `\\` 解码），
   提取 headline：Python traceback 末行（最后一条
   `SomeError: message` 形状）。仅做 PRD 定案 4 的两个形状，HTTP 等
   后续再加。
3. 呈现：折叠态一行 headline 优先展示；展开态完整 trace 进等宽代码块，
   真实换行、缩进保留。失败态的视觉层级沿用 ToolCallout 既有 tier 体系。
4. `previewFromContent` 对命中信封的内容不再做「头 500 字符」盲切——
   预览应含 headline。

## 验证

- 单测：#22 样本 1（含 banner + 多帧 + 尾部 JSONDecodeError）→
  headline 为 `JSONDecodeError: Expecting value...`，展开为真实多行；
  样本 1b（700 字符第三方输出 + 粘尾 traceback）同理；
  denied 信封行为不变；非 JSON / 非 error 形状内容渲染无回归。
- `pnpm --dir gui typecheck` / `lint`；真机验收由 JC 做（属 Tauri 依赖
  面，按工作默认走静态检查 + JC 目检）。
