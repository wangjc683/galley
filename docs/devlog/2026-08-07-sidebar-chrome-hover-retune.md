# Sidebar hover 失明：chrome 加深的次生灾害与 scope 覆写修复

日期：2026-08-07。起因：JC dogfood 反馈 Sidebar（顶部按钮 + session
行）hover 色块在背景色调整后变得非常不明显。

## 诊断

08-05 chrome 加深（`#F4F3F1` → `#EFEEEC`，ΔL* 2.11 → 3.86，见当日
devlog）没有联动检查放在 chrome 上的交互色。`--color-hover`
（`#F0F0F0`，L* 94.8）按"亮表面上压一档"校准，加深后 sidebar 底
（L* 94.1）反而比 hover 色更暗——hover ΔL* 只剩 0.7 且方向反了
（变亮），不可见。加深前 ΔL* 1.0 本就勉强，故体感是"本来不太明显，
调整后彻底没了"。Dark 无此问题（chrome L* 3.9 vs hover L* 14，
ΔL* ~10）。

## 定案：`.chrome-hover-scope` 作用域覆写（方案 1）

Sidebar `<aside>`（`bg-chrome` 层）挂 scope class，light 下覆写
`--color-hover` 为 `#E5E3E0`（L* 90.2）。数值沿用 chrome 自己的校准
逻辑：chrome 相对 app 压 ΔL* 3.86，chrome-hover 相对 chrome 也压
~3.9，同一条暖中性灰轴。用项目现成的 `html:not([data-theme="dark"])`
light-only 惯用法（首帧无 `data-theme` 的理由见 cjk-prose 规则）；
dark 不覆写。

选 scope 覆写的核心理由：**15+ 处 `hover:bg-hover` 调用点零改动**，
未来 sidebar 内新组件写 `bg-hover` 天然正确——"忘用专用 token"正是
这类 bug 的成因，方案把正确性做成默认。两处静态 `bg-hover` 填充
（ProjectReview 激活段、SessionRow 菜单开启态）同样在 chrome 上失明，
被顺带救活。Radix 下拉 portal 到 body 逃出 scope，继续用全局值——
浮层是 elevated 白底，全局值在那里本来就对，portal 逃逸恰好是正确
行为。

## 被否方案

- **新增显式 `--color-hover-chrome` token**：最可 grep，但要改全部
  调用点，且未来新组件必须记得用对 token，忘了就是本 bug 重演。
- **全局改 alpha 墨色叠层**（ink 5–6%，任意背景自动成立）：系统性最
  优雅但爆炸半径最大——`--color-hover` 同时是 inline code 填充的色系
  基准，波及主区全部 hover 与 code 观感，超出本次范围。

## 遗留观察

`--color-selected`（`#F8EDDA`，L* 94.2）与新 chrome（94.1）明度完全
持平——session 选中行现在只靠杏色色相撑。暂不动（有色相撑着，性质
不同于 hover 的纯明度失明），记入 deferred.md，dogfood 觉得弱再处理。

## 联动

`globals.css`（scope 规则 + `--color-hover` 定义处指路注释）、
`AppShell.tsx`（aside 挂 class）、`docs/design/foundations.md` hover
token 行回写、`deferred.md` selected 观察项。
