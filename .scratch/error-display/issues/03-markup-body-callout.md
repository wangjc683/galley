# 03 markup 正文的 parse-failure 呈现

Status: ready-for-human

## 范围

纯 GUI（PRD 定案 6）。核心触点：

- `gui/src/lib/ipc/ga-output-cleaning.ts` — 白名单清洗器所在，
  invoke/parameter 不入白名单（不能剥掉：剥了正文只剩脚本残文，
  且用户失去「发生了什么」的线索）
- `gui/src/components/conversation/Conversation.tsx` /
  `MessageAgent.tsx` — 最终答案渲染分流点

## 内容

1. 检测：assistant 正文以工具调用 markup 为主体（以 `<invoke` 开头或
   markup 块占比过阈值；与 issue 01 的判定逻辑共享形状定义，两处实现
   语言不同，注释互相标注）。
2. 命中时不走 MarkdownView 散文渲染，改为：一行产品语态说明（该轮
   工具调用未能送达引擎，常见于第三方代理把工具调用当纯文本返回）+
   折叠等宽代码块装原始 markup。审计一击可达，默认合上。
3. 流式部分（`cleanPartialContent` 路径）：正文以 `<invoke` 开头时避免
   散文闪现，可截断待 settled 后按上述 callout 呈现。

## 验证

- 单测：#22 样本 2（整条正文即 `<invoke name="code_run">...` 块）→
  命中分流；正常含 markdown/代码块的最终答案不误判（含正文里合法
  讨论 `<invoke>` 字样的边界，如内联 code span）。
- `pnpm --dir gui typecheck` / `lint`；真机验收 JC 做。
