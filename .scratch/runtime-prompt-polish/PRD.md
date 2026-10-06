# 打磨内置模式的系统提示词（Galley Runtime 层）

Status: needs-triage（2026-10-06 已做三轮：`issues/01` 方向一常驻部分、`03` 减法与预算闸、`04` IM 入口层；
`02` 指南暂缓；真机回归清单第 6、9、10–17 条待 JC；其余候选方向见文末）

来源：2026-10-06 JC 发起讨论「优化和打磨 Galley 的系统提示词」，第一个方向是「能回答用户关于 Galley 的信息、功能和指南」。
JC 回「认可，按建议推进」。

范围：只动 Galley 自己的 Runtime 层（`core/src/managed_prompt.rs`，组成方式见
[prompt-composition](../../docs/managed-ga-runtime/prompt-composition.md)）。GA 核心提示词与 GA 记忆不动。
外置模式零变化（宪法第 1 条，外置不注入这一层）；IM 渠道共用静态规则，一并生效。

## 依据（2026-10-06 核实）

- 用量：workbench.db 437 条用户消息里，问 Galley 本身的约 10 条（约 2%），多是 JC 自测，集中在「介绍一下 / 你是谁能干什么 /
  什么版本 / 最新版更新了什么」。「怎么做某事」在本机数据里没有，社区 issue 里有（#24 空 API Key、#27 搜历史、#31 定时迁移）。
- 失败形态：
  1. 把内核能力与 GA 记忆里的 SOP 当成 Galley 功能，并往多里说：`s-mqhxgvy8`（06-17）称能「设置定时任务、后台自主运行」，
     `s-mpw1w1el`（06-02）称能「图片生成/编辑」、讲架构基本是编的。GA 核心提示词开头「物理级全能执行者……禁止推诿」加剧这一点。
  2. 照念提示词原文：`s-mu3rzev1`（09-16）回答 what is galley 时整句复述「a somewhat mysterious figure… The mystery is
     part of the answer」。
  3. 过时：About 的定位仍是「local desktop workspace for AI agents」（09-09 起是个人助手 + Less harness. More model.）；
     没有 Goal、定时、项目、阅读面板；渠道与历史一节只列微信、飞书。
  4. 做得好的：问「最新版更新了什么」时模型自己去读 GitHub Releases，准确。

## 方向一拆成四件事

| | 内容 | 放哪 |
|---|---|---|
| a 身份 | Galley 是什么、与内核的关系、你是谁 | 常驻 |
| b 功能地图 + 入口 | 有哪些功能、在界面哪里、怎么用 | 常驻一份精简地图；细节按需读（`issues/02`，暂缓） |
| c 能力边界 | 哪些配置只有用户能在界面里改 | 常驻（准入测试三条都过） |
| d 版本与更新 | 版本号在状态块；更新内容指向 Releases | 常驻一行 |

交付方式裁 **B**：常驻精简（a + c + 一张地图 + d 一行），细节做随 App 发布的按需指南；节奏是先做常驻部分，指南等启动信号。
否决：A（全写进常驻，2% 的需求让每次请求多付几百词，且违反准入测试第 2 条）；C（指向线上 README，网络与版本错位，
README 偏宣传不讲操作，只留 Releases 一行用于「更新了什么」）。

## 第二轮：减法与预算闸（`issues/03`，已做）

JC 提出「less harness，要控制系统提示词的量」。实测 Galley 静态规则约 1710 tok，是固定前缀里最大的一块；
裁定先减法再上闸，不加新条款。

## 后续候选方向（未裁，逐轮讨论）

1. 与 GA 核心提示词对齐：「禁止推诿」与能力边界的张力已由边界一节覆盖，暂无新事故，不加文字。
2. 告诉模型界面能渲染什么：804 条最终回答里 mermaid / LaTeX 为 0，无事故，不加。
3. 回归网：现在只有 [prompt-composition](../../docs/managed-ga-runtime/prompt-composition.md) 的手动清单，没有遥测。
4. ~~IM 入口层~~：2026-10-06 已做，见 `issues/04`。

## 第三轮：IM 入口层（`issues/04`，已做）

JC 裁定 IM 定位为「同一个助手，用户从手机 IM 上对话」，按方案 A 瘦身，重点是手机上的简洁与阅读体验。
