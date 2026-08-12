# 01 summary 双端清洗：属性容忍正则 + markup 占位

Status: ready-for-human

## 范围

两端同步修改（keep-in-sync 契约，两处注释互相标注）：

- `runner/workbench_bridge.py:142` `_clean_turn_summary`
- `gui/src/lib/session-summary.ts:21` `cleanSessionSummary`

## 内容

1. 标签正则改为容忍属性：`<\/?[a-zA-Z][\w-]*>` →
   形如 `<\/?[a-zA-Z][\w-]*(\s[^>]*)?>`（自闭合 `/>` 一并考虑）。
   已验证现正则对 `<invoke name="code_run">` 不匹配、原样穿透。
2. markup 占主导判定：剥标签前先检测原文是否以工具调用 markup 为主体
   （如以 `<invoke` 开头 / markup 占比阈值）。命中则整条 summary 替换为
   产品语态占位（PRD 定案 2，文案定稿时按 copy-language-guidelines），
   不输出清洗残文。
3. 裸标签过度清洗行为不变（PRD 定案 5）。

## 验证

- 双端单测：#22 真实样本（`<invoke name="code_run"><parameter
  name="script">import json ... e(js)print(len(js))`）→ 占位文案；
  smart_format 截半样本（`<invoke nam ... e(js)`）→ 不产生标签碎片；
  既有用例全过（`runner/tests/test_workbench_bridge.py`、
  `gui/src/lib/session-summary.test.ts`）。
- `pnpm --dir gui typecheck` / `lint`；runner 三件套
  （pytest / mypy / ruff）。
