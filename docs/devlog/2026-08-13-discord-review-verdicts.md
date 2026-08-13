# Discord 方案外审四票裁决 + Rule 4 解释入宪

日期：2026-08-13
关联：`.scratch/discord-channel/PRD.md`（暂缓中）、AGENTS.md Rule 4、
`.scratch/ga-log-retention/`、`.scratch/im-owner-bind-race/`、
`.scratch/model-toast-telegram/`

## 背景

Discord Channel 方案（暂缓 PRD）经 Codex（gpt-5.6-sol）外审出 14 条
发现：技术修正已折入 PRD（消息 origin 路由、单 dispatcher、per-channel
prompt 注入、close 协议、连接状态机等），另重开/新开四票由 JC 当日
投毕。Discord 本身仍在暂缓状态；本 entry 记录的是**即刻生效或防重提案
价值高**的部分。

## 即刻生效：Rule 4 解释入宪

GA 引擎在 managed state root 下自产的运行日志（`model_responses`，
服务 `/restore` 与排障）判定为**引擎内部状态**，不算「Galley 存储
supervisor 对话」；Rule 4 管辖的是 Galley 自己的数据库与产品面。
解释句已补进 AGENTS.md Rule 4。这平掉了外审对飞书/Telegram 现状的
「违宪」指控——**已否决**的对立解释是「判定越线、managed 前端全面禁
prompt/response 日志」：为解释分歧付引擎减法 + 重构现有两渠道，不值。
「合宪但不卫生」的部分拆成独立小项
[ga-log-retention](../../.scratch/ga-log-retention/issues/01-managed-state-log-retention.md)
（保留策略/披露，needs-triage）。

## 四票裁决摘要（细节与被否决候选在 PRD「外审四票裁决」节）

1. 输出可见性 → 纯文档声明（否决 owner-only 频道 API 校验捆绑方案，
   JC 裁定 V1 从轻；真实泄露反馈出现可重审）。
2. 激活语义 → 沿用上游隐式激活（@提及激活后 owner 该频道全部发言进
   agent），setup guide 承载告知。
3. 配对场所 → owner 配对只认 DM + 错误尝试按用户限流；**不继承**
   Telegram「10 次错码全局作废」先例——成员可见 bot 的语境里那是
   恶意作废 DoS 按钮。此条对将来任何 guild 型渠道都适用。
4. Rule 4 → 见上节；随 Discord 补丁附带两件卫生活（dcapp 消息日志
   去内容化、附件每 turn 清理）。

## 外审顺带产出（与 Discord 解耦）

- Telegram 打包缺口（`GA_DEPS` 漏 `python-telegram-bot`）——当日已修
  并进冒烟门禁；
- 模型配置 toast 漏查 Telegram——当日已修（`use-model-config-toast.ts`
  是 channels 状态的第四方消费者，新渠道触点清单必须包含它）；
- owner 绑定「先持久化后验代际」竞态（飞书/Telegram 均中招）——
  needs-triage，Discord 接入前必修。
