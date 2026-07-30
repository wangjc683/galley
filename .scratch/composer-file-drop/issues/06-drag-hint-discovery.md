# 06: 拖放能力的发现性——空稿 footer hint

Status: done（2026-07-29 实现完成；typecheck/lint/vitest 全过。
`resolveComposerHint` idle 分支按 `hasText` 交接：空稿 →
`dragToReferenceHint`，有稿 → `enterHint`；Goal armed 优先于拖放提示。）
Blocked by: 03

## 背景与裁决（2026-07-29，JC）

功能上线后用户如何得知"任何文件/文件夹都能拖进对话框"？讨论结论：

- overlay 与 📎 菜单已是两个"意图时刻"的教学面，缺口是从不尝试的用户。
- 采用 footer hint slot，但**按状态交接而非定时轮播**（轮播 = 闪烁噪音）：
  - 空稿 + 空闲 → 「拖入任意文件或文件夹即可引用其路径」；
  - 有稿 + 空闲 → 现有「Enter 发送 · Shift+Enter 换行」（此刻 Enter 才有意义）；
  - 运行中 / Goal / 纠错各态不动。
- **永不退休（选项 A）**：slot 的语义是"当下为真的能力图例"，Enter 提示
  也从不退休；引入"学会即过期"等于往纯净语义里塞第二种规则，还要为一条
  提示引入持久化状态。JC 裁决 A。
- 已否决：常驻 placeholder 文案（永久噪音）、粘贴路径检测（启发式误报，
  记 backlog）、onboarding 蒙层（杀鸡用牛刀）。发版说明照常提及。

## 范围

- `lib/composer-hint.ts`：idle 分支按 `hasText` 分流，新 key
  `dragToReferenceHint`；更新头注释。
- i18n zh/en 新文案；无 kbd token，按纯文本渲染。
- `composer-hint.test.ts` 补分支用例。
