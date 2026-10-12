# 04（D）「它记得我什么」页面

Status: needs-triage

来源：主聊天 PRD 裁决 11、20、22（2026-10-09、10-12）。依赖 01。01 与 03 对外发版必须和本票同版。

## 目标

账本写的是对用户生活的推断（含情绪事件），用户必须能看、能改、能删，并知道它是怎么来的。

## 范围

- 查看、编辑、删除：GA 全局记忆（`memory/global_mem.txt`、`global_mem_insight.txt`）与事项账本（持续活动、已消失事项、情绪事件）。
- 说清来源与去向：挖掘每天读一遍你的对话，内容会再经过一次模型服务商；账本在你自己的电脑上，换模型带得走。
- 开关：可以关掉挖掘（廉价出口）。
- 用户亲手改过的内容，运行时升级与之后的挖掘不得覆盖（Rule 1 managed 规则「code is replaceable; user state is not」）。
- 只在内置；外置模式不出现。
- 视觉走真机流程；动手前查 `docs/design/` 相关禁令。

## 待定

- 放在哪：设置里一页，还是主聊天里能直达。
- 参考 OpenMuse「只记用户明确说过或确认过的」与上游 SOP「推断式」的张力怎么在页面上表达。

## 宪法 Rule 4 补句（2026-10-12 JC 定措辞；与本票同版落地）

来源：票 01 落地核对（见 01 的 Comments）：读日志、不进库与 08-13 解释一致，但 IM 归档是 Core 为账本写的、比日志活得久的副本，08-13 的字面盖不住。
2026-10-12 JC：其余几件按建议推进；改宪法照 Rule 2 的先例，措辞先给 JC 过目（主会话的做法，不是 JC 的原话）。同日 JC 认可下面的措辞，原样接在 `AGENTS.md` Rule 4 的 08-13 解释之后。
其中「用户能在 Galley 里查看和删除」要等本票做完才成立，所以随本票同版改宪法，不提前：

> Interpretation (2026-10-12): the affairs ledger (managed runtime only, off unless the user turns it on) keeps the user's own words from IM channels — never the agent's replies — under the managed state root's `memory/history_insight/`, so the engine's memory layer can still learn from them after engine logs are pruned. It is the user's memory state, not Galley conversation storage: it never enters Galley's database, the user can see and delete it in Galley, and runtime upgrades never overwrite it.

## Comments
