# Overlay 920 档定型 + session 摘要清洗与排版分工

日期：2026-08-07。起因：JC 觉得搜索（⌘K palette）和定时任务两个 Dialog
偏小。一路排查牵出三件事：overlay 尺寸阶梯的建立与两次上调、palette
session 行的排版 bug 与脏摘要数据链、以及 Earlier / Archived 是否与
palette 统一排版的形态裁决（结论：不统一）。

## 尺寸阶梯：560 → 640 → 920 的两次裁决

1. **第一轮**：JC 提议全部统一到 Settings 的 1040×680。agent 反对：
   Settings 的尺寸是左 tab + 右内容双栏撑起来的，单栏列表放进 1040 只会
   空旷；「统一感」的正确单位是**档位**而不是同一尺寸——尺寸差异本身传递
   「停留多久」的信号。首轮定三档：420 表单 / 640 列表浏览（palette、
   定时升到此档，对齐 Earlier/Archived）/ 1040 工作台。
2. **第二轮（真机推翻）**：JC 真机试后仍觉 640 局促，提出对齐常用提示词
   （PromptManagerDialog，920×680）。agent 接受——palette 长出全文命中
   卡片和标题+摘要预览后已是吃宽度的内容面，「单栏列表行宽」的推演被
   实测推翻。最终阶梯：**420 表单 / 920×680 内容工作台（Prompt Manager、
   Earlier、Archived 固定高；palette、定时自适应高上限 680）/ 1040×680
   Settings**。Earlier/Archived 随后跟进 920，640 档清空移除。
   阶梯表落在 [overlays-and-settings.md](../design/overlays-and-settings.md)。
3. 技术细节：palette 锚 `top: 18%`、窗口 minHeight 600，高度上限必须
   视口钳制（`min(680px, calc(82vh - 24px))`），否则最小窗口下越出下沿。
4. 定时空状态三个示例随 920 改成 `grid-cols-3` 模板卡片（纵排：标题 /
   周期 / prompt 三行 clamp）——原全宽横条在 920 下标题与右对齐时刻之间
   拉出 ~700px 空白。`justify-between` 的观感随容器变宽线性恶化，是本次
   两个 bug 共同的病根。

## palette 行排版 bug + 脏摘要数据链

截图里「整行横穿、标题消失、出现 `estion>` 碎片」的两层根因：

- **布局**：`PaletteRow` 的右对齐 `sub` 槽位是为短注解设计的
  （`shrink-0` 永不截断）；session 行把 80 字摘要塞进去，flex 下标题被
  压成零宽。修法：新增 inline `preview` 槽位（muted、truncate、跟在
  标题后流式排布），标题保底 65% 宽；`sub` 保留给 action 行短注解并在
  JSDoc 写明契约。
- **数据**：GA 兜底路径（模型没输出 `<summary>` 时，`ga.py`
  turn_end_callback 取回复正文 + `smart_format` 中间截断）会留下
  markdown 残渣和被拦腰砍断的 `<suggestion>` 标签碎片，且落库前
  `replace('\n','')` 使 `###` 常粘在句尾。修法：**双端镜像清洗**——
  runner `_clean_turn_summary` 在 emit 前清洗新数据；GUI
  `cleanSessionSummary`（`gui/src/lib/session-summary.ts`）在展示层
  修复历史数据，palette / sidebar / Earlier / Archived 四处接入。两边
  注释互指，规则改动必须同步。未动 managed-GA 补丁栈（被否方案：直接
  改 GA 兜底逻辑——受补丁最小化规则约束，且展示层清洗对历史数据免疫）。

## Earlier / Archived 维持双行（否掉与 palette 统一）

自动标题上线后 JC 提出三个 session 列表面是否统一排版。agent 首轮倾向
统一单行，被要求给独立意见后自我推翻，最终裁决**维持双行**：

- palette 是**回忆型快跳**（标题即主线索，单行高密度对）；
  Earlier/Archived 是**辨认型翻找**（用户因记不清才来，标题+摘要+日期
  三线索并用）。形态跟任务走，不跟数据对象走——sidebar 本就是第三种
  session 排版。最佳参照是邮件客户端的双行（主题+预览），不是命令面板。
- 密度论点被反驳：日期/PINNED 分组已提供 chunking，搜索栏使密度收益
  只在漫无目的滚动时兑现，而那正是摘要最有价值的场景。
- 遗留 derived 标题（80 字截断、永不升级）在这两个面浓度最高，双行
  对它们无感，单行会把摘要挤成缝。
- 真正该统一的是**语域**（状态图标、muted 层级、清洗规则、日期格式），
  已统一。

相关 commit：`6872a38c`（920 档 + 摘要清洗）、`946d3f3a`（browser 接入
清洗 + 双行裁决记录）。
