# 03 managed GA patch：ask_user 工具描述补「选项说明」约束

Status: ready-for-agent
Blocked by: 01, 02

## 范围

仅 managed runtime patch stack（Rule 1：不碰外部 GA）。按
`docs/managed-ga-runtime/README.md` 的补丁规则：最小、隔离、文档化、
可重放；上游若提供同能力则移除本 patch。

## 内容

ask_user 工具描述 / 提示中加约束：标签不能自解释的选项须补简短说明
（选它会发生什么、代价是什么）；涉及不可逆操作、覆盖数据、二选一
技术方案时说明不可省略。候选项对象形状与 issue 01 的数据面对齐。

## 验证

- patch 重放验证（managed-ga 构建流程）；dogfood：高影响提问场景下
  模型稳定产出 desc。
