# 2026-07-03 · Supervisor SOP 前沿模型重校准

> Status: implemented · Related:
> [2026-07-03 主动汇报 devlog](./2026-07-03-supervisor-proactive-reporting-design.md)（O5 的收口）·
> `docs/integrations/galley-supervisor-sop.md` · `docs/agent-api.md`

## Context

主动汇报落地后,IM 管理体验的质量瓶颈回到 supervisor 的判断质量,而判断由
SOP 决定。SOP 的确认姿态原本按弱模型下限设计;既已决定以前沿模型为默认
(主动汇报 devlog 的前提),按可逆性重划确认边界,并修复两处一致性问题。
选 SOP 而非 Settings tab 的理由:Settings 是一次性 setup 界面,SOP 是每轮
决策的行为规范,后者对持续体验的杠杆更大。

## Decisions

### D1. Goal 确认:拆掉 exact-phrase 咒语,保留两步硬保障

`确认启动 Goal` 是发布过的契约字段(`confirmationPhrase`,
`core/src/api/goal.rs:9`),但 core 从不校验用户回复——防误启动的硬保障
一直是 proposal + `internalConfirmToken` 两步流。硬编码中文精确短语对
英文用户直接断裂,且「用户必须念对咒语」违反「不要让用户思考」。

改法(零 schema 变更):契约字段原样保留,语义降级为「可向用户提供的
现成回复」;行为要求改为「用户以自己的语言、明确指向该提案的肯定回复」,
并显式排除随口的「ok / 嗯」和夹在无关消息里的同意。SOP / reference /
两份 SKILL.md / agent-api.md 措辞同步。

### D2. 风险动作按可逆性分档(修订 Hard Rule #4 / PRD §18.5 语境)

原规则把 stop、archive 和「外发、凭证、付款、commit/push、删除」混在同一档
ask-first。新分档:

- **不可逆 / 外部可见**(外发/发布、凭证、付款、commit/push、大范围文件
  改动、`project delete`、多 writer):先给影响摘要,等确认——不变。
- **可逆 session 操作**(`session stop` 可续跑、`session archive` 可
  `restore`):明确服务于用户请求时直接执行,**报告做了什么 + 如何撤销**。
  请求有歧义(如「删了它」)仍先问。

依据:前沿模型默认 + Galley 自身 YOLO 文化;「事事请示」是 IM 管理体验的
主要摩擦源,而误执行可逆操作的代价是一次 undo。

### D3. timed_out 话术改条件式,消除双文本矛盾

SOP 教「超时→请用户稍后来问」,IM entry layer(主动汇报后)教「我会主动
通知你」——同一场景两份指令矛盾,模型会随机采纳。SOP 是 BYO 通用文本
(BYO 没有 reporter),改为条件式:宿主环境有完成通知机制(Galley 管理的
IM 通道有)则承诺主动汇报,否则请用户稍后来问。

### D4. 副本同步 + Channels 一句话

- skill 目录四份 verbatim 副本(`.claude` / `.agents` × SOP / reference)
  已漂移(上一轮的 wait 600s 没同步),本次全部重同步并更新头注日期。
  同步靠人肉,无机制防漂移——候选改进:CI 校验副本与 canonical 一致。
- Settings → Channels 飞书已连接文案加一行「从飞书委托的任务完成后,
  Galley 会主动发消息告诉你」(en + zh)——让汇报功能对用户可见,
  反馈引导行动的最低要求。

## 未做(有意)

- CLI 输出的 point-of-need hint(如 `timed_out` 带 `hint` 字段):additive
  schema 扩展,单独立项。
- 主 header「Supervisor SOP」入口的术语问题:记账未动。
- `llm set` 维持无确认要求(可逆,且 SOP 本就只建议谨慎)。
