# 富 UI 回复：三路调研底稿（2026-10-16）

方案与裁决点在 [PRD.md](./PRD.md)。本篇是当天三路调研的结论与出处：Galley 现状、OpenUI 源码、业内横评。外部项目的状态都是 2026-10-16 查的，重开时先复核。

## Galley 现状

### 需求的 ground truth

`workbench.db` 只读统计（[reply-stats.py](./reply-stats.py)）。口径：可见的助手行、`final_answer` 非空、这一轮没调工具（收口轮）；表格是去掉代码块后存在表格分隔行；.html 只算本地绝对路径，网址不算。

| | 全部 | 内置 | 外置 | 主对话 |
|---|---|---|---|---|
| 条数 | 450 | 351 | 90 | 9 |
| 平均 / P90 字数 | 847 / 1983 | 939 / 2074 | 535 / 1481 | 373 / 906 |
| 含表格 | 32.2% | 36.2% | 16.7% | 3/9 |
| 含代码块 | 12.2% | 11.7% | 15.6% | 0 |
| mermaid | 0 | 0 | 0 | 0 |
| 本地 .html 路径 | 0 | 0 | 0 | 0 |

- 内置 9 月表格占比 46%（同设计文档里的 47%），10 月 18%。
- 工具调用：`file_write` 10 次、`file_patch` 18 次，没有一次写 .html / .png / .svg；内置引擎的临时目录 179 个文件，没有 html 与图片。

### 渲染与链路

- 回复正文：`gui/src/components/conversation/MarkdownView.tsx`，react-markdown + remark-gfm + remark-cjk-friendly（ask_user 另加 remark-breaks）；没有 rehype、数学、mermaid。代码块走 Shiki（`CodeBlock.tsx`），mermaid 只当普通代码；图片只认 https 与本地绝对路径的位图，svg、`data:` 降级成链接（`lib/markdown-image-src.ts`）；不用 innerHTML。
- Galley 自己的标签在 `gui/src/lib/ipc/ga-output-cleaning.ts` 剥掉，变成输入框建议、子任务卡片或不出声；`[FILE:]` 一律剥掉。
- 主对话不流式显示正文，回复整条出现（`components/screens/MainView.tsx`；设计见 conversation「助手的对话」）。
- 回复全程是纯文本 Markdown，结构化的只有工具步骤（[IPC 协议](../../docs/ipc-protocol.md)）；Core 清洗出 `final_answer` 后落库（`core/src/turn_persistence/`）。
- IM 四个渠道不进库：微信原样发、删图、4000 字分条（`runner/im_wechat.py`）；飞书放进卡片的 markdown 元素（`managed-ga/code/frontends/fsapp.py`）；Telegram 转 MarkdownV2、表格改列表；Discord 按 1900 字切。IM 提示层规定不用表格和标题（[prompt-composition](../../docs/managed-ga-runtime/prompt-composition.md)）。
- iOS：手机拿到原始 Markdown（`remote-protocol/src/app/types.rs`）；iOS PRD 裁决 16 定 Swift 原生绘制，否了 WKWebView（已封存）。

### 提示词与规范

- 内置提示词在 `core/src/managed_prompt.rs`，静态段 6775 字节、预算没有余量；新条款要事故驱动，「不是 persona 层」（prompt-composition 准入测试）。外置没有系统提示通道（AGENTS.md Rule 1）。
- 按需读的先例：助理手册（`core/src/assistant_manual.rs` 编译进 Core，主对话启动时写到状态目录）；Supervisor SOP 写到 `im/reference/`；deferred「Galley 使用指南」同一思路。
- 设计禁令：不做 dashboard、不借 Claude.ai 的 artifact 侧栏（`docs/design/foundations.md`）；回复读成一份文档，不是样式拼贴；卡片借工具块的外框，不加投影（`docs/design/conversation.md`）；复制出来的文字与原文一致（`docs/typography-principles.md`）。
- 旧裁决：10-06「告诉模型界面能渲染什么」被否（0 事故）；08-07 Artifacts 搁置，HTML 预览的 iframe 禁止 `allow-same-origin`（deferred「Artifacts」）；`.scratch/session-workspace/PRD.md` 否了每轮的「本轮产物」清单。
- 上游 GA：系统提示对输出格式没有约定；上游桌面端用 marked + KaTeX + hljs，剥掉 iframe 与 script（`managed-ga/code/frontends/desktop/static/app.js`），没有卡片与 HTML 预览。
- 现有替代路径：阅读面板能预览 Markdown、位图（≤10MB）与文本；svg 被 Core 拒（`core/src/local_file.rs`）；.html 只显示源码。

## OpenUI（thesysdev/openui @ c0e6b0f9，2026-10-15）

只读源码，没在仓库里装依赖或构建。缩写：`lc/` = `packages/lang-core/src`，`rl/` = `packages/react-lang/src`，`ru/` = `packages/react-ui/src`。

1. **Prompt 重量**（打包仓库自带的 `lc/parser/prompt.ts`，输入 docs 线上路由用的 `docs/generated/*-library.spec.json`，js-tiktoken o200k_base 计数；Claude 分词器没测）：

   | prompt | 字符 | token |
   |---|---|---|
   | `benchmarks/system-prompt.txt`（旧快照） | 13,080 | 3,281 |
   | 聊天库（84 个组件）+ 官方 options | 53,352 | 13,961 |
   | 聊天库，不带 options | 26,674 | 6,376 |
   | 通用库（82 个组件）+ 官方 options | 36,113 | 9,199 |

   近似线性：固定约 700–840 token，每个组件约 54–57 token；可只挑子集（`lc/library.ts` 的 `extend({components:{remove}})`）。
2. **正文与 UI 怎么混排**：官方默认整条回复都是 Lang，prompt 写死「ENTIRE response must be valid openui-lang — no markdown」（`lc/parser/prompt.ts:121`），正文写进 `TextContent` / `MarkDownRenderer` 组件。inlineMode 只拼接围栏内的代码，围栏外文字被丢掉（`lc/parser/parser.ts`）。tool call 模式：assistant-ui 包的 `present_openui` / `prompt_openui`；Open WebUI 插件让模型平时写 Markdown、需要时调 `render_openui`；langchain 包走 AG-UI 的 `custom:openui`。
3. **流式解析**：已完成的语句缓存，末尾半行补引号、补括号后重新解析；前向引用先渲染为空；不合 `name = expr` 的行静默跳过（#582 在要严格模式）；模型写成纯文字时报 `parse-failed`、渲染器返回 null（`rl/Renderer.tsx:396`），没有降级成文本；自动修复只有收费的 Autofix。
4. **交互**：点击都经 `onAction` 交给宿主；react-ui 把 `@ToAssistant` 变成带表单状态的新一轮用户消息，`@OpenUrl` 直接 `window.open`；「Built-in data fetching」是 `Query` / `Mutation` 调宿主传入的 `toolProvider`，生成的 UI 不能自己请求任意 URL；「runtime-evaluation」是 AST 解释器，没有 `eval`。安全缺口：`@OpenUrl` 与 Image `src` 不校验协议，toolProvider 里的工具模型都能调。
5. **组件与依赖**：`defineComponent({name, props: z.object(...), description, component})`（zod v4），可以只用 react-lang 配宿主自己的组件与样式。react-lang 1.0.1 约 370KB（另依赖 lang-core 1.4MB、devtools 0.9MB）；react-ui 0.18.1 约 16MB（Radix、d3、katex，SCSS 编译的 CSS + `--openui-*` 变量）。React 18 / 19 都支持；react-ui / react-headless 的 peer 要 zustand ^4.5.5，Galley 是 ^5。
6. **模型可靠性**（官方自测 `docs/content/blog/generative-ui-benchmark.mdx`）：6 个模型结构合法率 96.5%，生产流量约 7% 首轮不合法；小模型明显不行：Qwen3.6 35B-A3B 61.4、Gemma 4 31B 46.7、Phi-4 44.0。
7. **非 Web 与降级**：没有 Swift / Kotlin 渲染器，「mobile」是 React Native 且组件手写；没有转文本 / Markdown 的降级；browser-bundle（JS 约 3.2MB）可塞进 WKWebView。
8. **成熟度与耦合**：react-lang 1.0.0 在 2026-10-12 发布、带多项 breaking，react-ui 一个月内 0.14 → 0.18；约 90% 提交来自 Thesys 员工与 bot；Gateway / C1 / observability-cloud 都不是必需。默认联网：lang-core 的 postinstall 向 PostHog 上报（pnpm 10 默认不跑依赖安装脚本，没实测）；CLI 默认开遥测；`NODE_ENV=development` 时 react-lang 从 jsDelivr 拉一段 devtools 脚本执行，`tauri dev` 会触发；`OPENUI_TELEMETRY_DISABLED=1` 可关。

## 业内横评

| 路线 | 代表 | 提示词注入 | 降级成纯文本 | 安全 | 原生 iOS |
|---|---|---|---|---|---|
| 组件 DSL / JSON | A2UI、json-render、OpenUI | 重：catalog 上万 token | 没有官方方案 | 最强，不执行代码 | 每端一个渲染器，A2UI 的 SwiftUI 版未发 |
| 工具结果驱动 | MCP Apps（SEP-1865）、OpenAI Apps SDK | 无，UI 由工具作者写 | 好，工具必须带文本 | iframe 沙箱 + CSP | 需要 WKWebView |
| 模型写 HTML 进沙箱 | Claude artifacts / visuals、LobeHub、OpenClaw `show_widget` | 中：几 KB 设计指南 | 差，要另写正文 | 全看宿主的沙箱 | 需要 WebView；Claude visuals 不在手机上显示 |
| 增强 Markdown | 各家桌面助手的 mermaid / svg / KaTeX | 近零 | 天然 | 净化 SVG 即可 | 原生 Markdown 库 |

- 本地 / 桌面助手的实际选择：Cherry Studio、LobeHub、Open WebUI、Chatbox、LibreChat 都是增强 Markdown + 模型写 HTML（artifacts 或代码块卡片）；Jan、Msty 是实验功能或默认关；MCP Apps 集中在大厂宿主与 Goose。没有一家在主对话里用组件 DSL。
- 和 Galley 最像的是 OpenClaw `show_widget`：只有声明了 `inline-widgets` 的客户端拿得到这个工具，IM 渠道上看不到；iOS / Android / macOS 用隔离的 WebView 渲染，Discord 上发一个「Open widget」按钮；`sendPrompt` 必须由用户手势触发、每分钟最多 10 次。
- 常被忽视的坑：一条回复会发往多端，回复必须是「文本正文 + 可视附件」；`allow-scripts` 加 `allow-same-origin` 等于没有沙箱（Open WebUI CVE-2026-45303，Cherry Studio 的交互预览仍这样配）；Tauri 下还要防 IPC 暴露给 iframe；HTML 写进历史会一直占上下文；点击回发要校验手势并限频；画坏了要能退回源码。

### 出处

- A2UI：https://a2ui.org/ ；协议 https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md ；渲染器 https://a2ui.org/reference/renderers/ ；Express 提案 https://github.com/google/A2UI/tree/main/specification/proposals/express
- json-render：https://github.com/vercel-labs/json-render
- AG-UI 与 CopilotKit：https://docs.ag-ui.com/concepts/generative-ui-specs ；https://docs.copilotkit.ai/built-in-agent/generative-ui/open-generative-ui
- MCP Apps：https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp ；https://modelcontextprotocol.io/extensions/client-matrix ；https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- assistant-ui：https://www.assistant-ui.com/docs/tools/generative-ui
- Claude visuals：https://claude.com/blog/claude-builds-visuals ；https://support.claude.com/en/articles/13979539-visuals-in-claude
- LobeHub artifacts skill：https://github.com/lobehub/lobehub/blob/canary/packages/builtin-skills/src/artifacts/content.ts
- OpenClaw `show_widget`：https://docs.openclaw.ai/tools/show-widget
- Cherry Studio：https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/components/CodeBlockView/constants.ts ；`HtmlPreviewFrame.tsx` 同目录
- Open WebUI：https://docs.openwebui.com/features/extensibility/plugin/development/rich-ui ；CVE https://api.osv.dev/v1/vulns/CVE-2026-45303
- Chatbox：https://github.com/chatboxai/chatbox/blob/main/src/renderer/components/Artifact.tsx
- LibreChat：https://github.com/danny-avila/LibreChat/blob/main/packages/api/src/prompts/artifacts/index.ts
- Streamdown（流式 Markdown）：https://github.com/vercel/streamdown
