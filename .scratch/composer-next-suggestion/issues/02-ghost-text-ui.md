# 02: Composer ghost text + ArrowRight 接受

Status: ready-for-human（已实现，待 dogfood 验收）

## 范围

- messages store：`turn_end`（final、visible）携带 `nextSuggestion` 时存入该
  会话消息态（随会话切换/restore 存活）；新 run 开始（appendUserTurn）清空。
- Composer ghost overlay：派生条件
  `会话空闲 && composer 为空 && 最新建议非空` 时在 textarea 上层渲染浅色
  建议文本（无 dismissed 状态；灰度对齐 `placeholder:text-ink-muted/50`）。
  ghost 显示时抑制原生 placeholder 避免叠字。
- ArrowRight（输入框为空时）→ 经 `prefillText` 填入并聚焦；沿用
  `isImeCompositionKeydown` 保护；Tab/Esc 不动。
- restore：建议随 turn_end 持久化载荷回放（确认 SQLite 消息行是否天然携带；
  不携带则 v1 接受重启后 ghost 不恢复并记录）。

## 验收

- pnpm typecheck / lint；ghost 谓词与清空时机的单测（store 层）。
- JC 真机 dogfood（managed 模式跑一轮，看建议质量与口吻）。
