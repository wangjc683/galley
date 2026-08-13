# Discord setup 教程打磨：链接化、精简、Administrator 默认

日期：2026-08-13
关联：§9 Channels Discord 节（本次修订三条文案裁决已入规范）、
`im/step-link.tsx`、`ConnectionSteps.tsx`

## 背景

JC 真机走完 Discord 配置全流程后的第一手反馈：Portal 应该可点、
文案该更简、OAuth2 步骤可优化。逐条裁决如下。

## 裁决

1. **专有名词链接化（inline，非按钮）**：`ConnectionSteps.steps` 宽化
   `string[]` → `ReactNode[]`（key 随之改 index），新增
   `stepWithLink`（独立文件 `step-link.tsx`，react-refresh 规则不许
   与组件同文件混导出）——copy 用 `{link}` 占位符、专有名词标签留在
   代码里（不可翻译）。样式走 `SettingsUpdateControl` 的 anchor 先例。
   已否决飞书式「打开 Portal」独立按钮：链接与步骤文字分离，不如
   就地可点。顺手项：Telegram 第 1 步 @BotFather 同步链接化
   （t.me/BotFather）。
2. **症状句删除，「症状倒推」条款让位**：初版 setup 第 2 步的长症状
   说明写于 PRD 期（当时运行时无诊断）；落地后 dcapp 连接状态机把
   `PrivilegedIntentsRequired` 判永久错误、错误详情直说开关位置，
   `discordErrorHint` 亦有排查清单——教程症状句成为冗余。新分工：
   **引路归教程、诊断归错误态**。§9 原「症状倒推写法」条款按此改写
   （规范让位：前提失效）。
3. **Step 3 加 Administrator 权限引导**（JC 提议，采纳理由比「更强大」
   硬）：缺权限失败是**静默的**——bot 缺 View Channel 时收不到 @ 提及，
   无异常可分类，激活悄悄不发生，比 Intent 坑更难自诊。私人 Server
   语境下邀请时一次给足是消灭该类坑的省事默认。Trade-off 留痕：token
   泄露 = 该 Server 完全接管，私人 Server 爆炸半径可接受；**教程若
   将来面向共享/社区 Server，此默认必须重审**。
4. **Step 3 路径选 OAuth2 而非 Installation 页**：3a（Installation 页
   安装链接）更短，但其可用性未经 JC 实测确认，而 JC 刚亲手走的是
   OAuth2 路径——选已被验证的。若后续 dogfood 确认 Installation 页
   更顺，一行 copy 即可切换。
5. 全量精简后的 4 步（zh）：Portal（链接）建应用复制 Token → 同页开
   MESSAGE CONTENT INTENT → OAuth2 勾 bot + Administrator、邀请链接
   加进 Server → 启动服务后 DM 配对码绑定、频道 @ 激活。删掉的解释
   句（「只能收到所在 Server 的消息」「6 位」「保存 Token 并」）均为
   步骤自明或界面就地承载（BindCodeCallout 显示码本体）。
   `discordConnectedSteps[0]` 同步收紧。卡底两条安全声明**不动**
   （票 1/2 唯一防线，§9 明文不得降级）。

## 验证

typecheck / lint / `git diff --check` 绿；纯 copy + 展示层改动，
按惯例 JC 真机验收视觉效果。
