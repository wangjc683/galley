# 2026-07-03 · README 双层价值主张重构（中文定稿 + 英文同步）

> 同日第五篇。Owner 把 README 定性为「项目主页 + 独立开发者能力展示面」，
> 要求在独立产品定位下把引擎（GenericAgent）的产品特性升格为 Galley 的
> 卖点。流程：中文为准逐段过稿 → 定稿 → 英文按原生语气同步（非逐字翻译）。

## 结构诊断

旧 README 只回答「怎么管」不回答「能干什么」：八张 Highlights 全是编排层
（多会话 / Goal / 双原生 / 审批 / Channels / 持久化），引擎能力只有
「浏览器控制」半张卡——旧「壳」定位的遗迹（引擎宣传当年归 GA 自己的
README）。独立产品定位下，引擎能力就是 Galley 的能力，而访客的第一问
恰恰是「这东西能帮我干什么」。

## 改动

- **定义段**：先「能做事」（操作浏览器 / 终端 / 文件 / 手机）再「管得住」。
- **Highlights 重组为两层**：「单个 agent，能干活」（新 4 卡：系统级执行、
  真实浏览器、自进化技能、Token 效率）+「一支团队，管得住」（原 6 卡
  编排层保留）。引擎组首行一句完成内核归属 + 开箱即用双重交代（吸收原
  「开箱即用」卡）；原「浏览器控制」卡并入「真实浏览器」（删「剩下的交给
  想象力」营销腔）。
- **Token 效率卡两轮修正**：(1) owner 纠正上游 30K 宣传已过时——Galley
  的 `MANAGED_MODEL_DEFAULT_CONTEXT_WIN = 90_000`（migration 027/029 回填
  存量），改写为「机制在前（按信息密度裁剪）+ 90K 作为 Galley 的产品决策
  （为长任务留余量）」；(2) owner 指出卡内 arXiv 引注怪——确认为借权威
  撑腰的不自信（与致谢辩护清单同病），删去；沉淀规则：**主张写在卡片里，
  证据放在文末**（「引文只住题词位与版权页」在 README 的形态）。
- **致谢重写**：删「当前的 agent 内核」（临时性措辞）与「在此之上 Galley
  提供……」价值辩护清单（辩护即壳焦虑，且与 Highlights 重复）；换成慷慨
  的单句致意 +「没有这份干净的地基，就没有 Galley」。
- **模型兼容补进 Quick Start**：清单逐一对照 `managed-model-presets.ts`
  真实预设；初稿的 Gemini 被删（上游支持但 Galley 无预设，写即过度声称）。
- **attach 段降权**：「Galley 是什么」下的整段并入 Quick Start 安装提示
  （非侵入承诺句保留），身份区收紧为纯身份陈述。
- **旧称谓对齐**：Architecture「Galley-managed GA」、Under the Hood
  「bundled GA」→「内置内核 / bundled engine」。
- **保持现状**：分节标题中英混用（Quick Start / Architecture 是中文技术
  读者的原生词汇，翻译反降扫读效率）；hero 副标题（编排定位在 hero 层
  仍最差异化，引擎能力由正文首段承接）。

## 发现：截图资产全套过期（高优先资产任务）

五张截图（含 hero 主图）全部是 v0.1 dev-mock 建构：INTRO / EMPTY / MAIN /
+TOAST / +MOCK 调试按钮入镜、全大写「GALLEY」旧 wordmark（规范已废止）、
已删除的空状态四句引导 prompt、已退役的「GenericAgent 的本地桌面工作台」
副标题。作为作品集主页的视觉资产，这是当前 README 最伤的一项。待办：
owner 在当前版本布置真实内容重拍全套 + 录 Galley 界面的演示 GIF（引擎
能力靠秀不靠说；直接借上游 GIF 不可行，那是 GA 自己的界面）。

## 验证

中文稿 owner 逐段过并定稿；英文按 copy-language-guidelines「两套原生
文案」原则重写同步。纯 Markdown 改动，无代码面；`git diff --check` 过。
