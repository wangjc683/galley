# 中文加粗漏星号：换 remark-cjk-friendly，删自写插件

Date: 2026-09-23
Status: implemented; static gates green; unreleased
Related: [typography principles §红线](../typography-principles.md),
[foundations §CJK 相邻问题](../design/foundations.md),
[conversation design §Markdown](../design/conversation.md)

## 起因

JC 在「揭阳自驾游指南」session 的最终回答里看到满屏 `** **`，阅读被打断。
这条回答漏出 30 个 `**`，全是同一种写法——粗体小标签 + 全角冒号 + 紧跟
正文：`**早餐：**肠粉`、`**第 1 天：**揭阳古城`、`**注意地理范围：**揭西`。

## 原因

CommonMark 的 flanking 规则：结束 `**` 若紧贴在标点后，它外侧必须是空格
或标点才算右侧界定符。英文 `**Note:** text` 有空格，没事；中文不打空格，
`：**` 外侧是「肠」，结束符不成立，开头的 `**` 也配不上对，两个都当字面量。
上游 [commonmark-spec#650](https://github.com/commonmark/commonmark-spec/issues/650)
讨论多年未改。

06-09 起的自写插件 `remarkCjkAdjacentQuotedStrong` 只修 `名叫**"引号"**`
一种形态（开头符左侧是汉字、内侧是引号），「标签：」这种不在它的正则里。

## 数据（全库 751 条回答，用真实管线 remark-parse 11 + remark-gfm 4 重渲）

| | 漏星号的回答 | 漏出的 `**` |
|---|---|---|
| 现状（gfm + 自写插件） | 11 条 / 11 个 session | 64 |
| gfm + `remark-cjk-friendly` | 1 条 | 2 |
| gfm + `remark-cjk-friendly` + 自写插件 | 1 条 | 2 |

- 频率低但成片：09-01 起 252 条里 6 条（2.4%），可一旦模型用「粗体标签：」
  写列表，整列都中招，一篇几十个星号。
- 剩下的 1 条是 06-09 模型写成 `** Spurs`（开头符后带空格），本来就是坏
  markdown，不修。
- 零回归：原本不漏的 640 条回答，strong 数量一个不变；单星号字面量
  （`510cm*` 脚注、`gpt-*` 通配）换前换后完全一样。
- 叠加自写插件结果不变 → 它覆盖的形态新包全接住，自写插件删除。

## 裁决（JC 全按推荐）

1. **换 `remark-cjk-friendly`，删 `remark-cjk-strong.ts`。** 它是 CommonMark
   CJK 修正提案的 micromark 实现（tats-u 维护），README 点名「原样显示 AI
   生成内容」的场景；只改星号怎么解析、不改字符，符合 typography
   principles 的修复插件准入标准（还原模型明确意图）。少一份自维护正则。
2. **全入口一起变。** `MarkdownView` 是 app 唯一 markdown 入口，回答、旁白、
   思考预览、ask_user、系统消息、教程、阅读面板里的本地 `.md` 都跟着走。
   代价：用户自己的 md 在 Galley 里比 GitHub 更宽容（这类写法显示为加粗，
   GitHub 仍漏星号）；方向是显示作者本意，接受。零回归数据只覆盖回答，本地
   文件未测。
3. **不加删除线配套包**（`remark-cjk-friendly-gfm-strikethrough`）：全库只
   1 条回答用过 `~~`。

实现细节：入口用 `remark-cjk-friendly/parseOnly`——默认入口会连带打进
`mdast-util-to-markdown` 序列化器，react-markdown 从不序列化；README 也
建议只解析的场景用它。`index` chunk +8.9 kB（gzip +3.5 kB），默认入口是
+12.6 kB。五个新包全是它的传递依赖，lockfile 只增不改。

否掉的：提示词让模型别这么写——外置 GA 管不到，模型习惯也压不住，渲染层
一处修全覆盖。流式补全（`mend-streaming-markdown`）本就不补强调，无交互。

纯前端渲染，内置 / 外置两种运行时模式零差异。
