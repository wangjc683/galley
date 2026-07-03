# 2026-07-03 · About「GA 预算」收敛 + onboarding 引擎称谓 pass

> 同日 colophon session 的第三步。Owner 反馈两点：「内置 GA 版本」仍是
> 套壳 GUI 感；题词夹在功能区块之间打断连续性。诊断把问题从单处措辞
> 抬到页面层面：**套壳感来自频率不是措辞**——GenericAgent 在 About 一页
> 出现 4 次（tagline / origin / 版本表 / links）。确立「GA 预算」原则并
> 顺手完成 onboarding / Health Check 的引擎称谓统一。

## GA 预算原则（已写进 copy-language-guidelines）

品牌表面上 GenericAgent 只出现两次：**一次有感情的**（origin story，
致意保留一字不动），**一次有事实的**（上游链接行，引擎 commit 作
detail）。产品的一句话自我描述说它是什么，不说它用什么做的。独立
定位的清理对象是结构性从属感，不是 credit——credit 给得体面，收敛才
不显得刻薄。

## About 改动

- **tagline 去 GA**：`基于 GenericAgent 的开源本地 Agent 工作台` →
  `开源的本地 Agent 工作台`（en: `An open-source local Agent workbench`）。
- **版本表只剩 Galley 一行**：独立产品只有一个版本号；引擎 commit 是
  材料信息（版权页语法：印在什么纸上），不是第二个产品版本。
  `galleyVersion` / `bundledGAVersion` 两个 key 删除。
- **Links 的 GenericAgent 行兼作引擎事实行**：detail 从裸 URL 改为
  `内核 b1e173dc · 2026-06-29`（en: `Engine …`；runtime 未上报 commit
  时回退 URL）。一行完成上游致谢 + 引擎可查 + GA 次数 −1。
- **题词挪到页面最底**（owner 反馈：原位置打断功能区块连续性）：
  版权页以引文收尾，不以 imprint 行收尾。新顺序：wordmark → origin →
  版本 → 版式 → Links → footer → 题词。

## 引擎称谓：内核 / engine（新术语规则）

managed 语境的用户可见文案不再出现 GA / GenericAgent（技术管道暴露），
统一称**「内核」**（en: **engine**）——中文用户对「基于 Chromium 内核」
有现成心智，隐含叙事恰好是独立产品 + 诚实交代引擎。attach 语境（接入 /
检查用户自己的 GA）**保留 GA**——那条流程的主题就是用户的 GA，改名反而
不诚实；「Galley 不修改你的 GA」信任承诺留在 attach 流程内。规则全文
见 copy-language-guidelines「内核 / Engine」节。

按此扫过的 onboarding / Health Check 条目（managed 项）：

| Before | After |
|---|---|
| GA 入口模块 / GA entry module | 内核入口 / Engine entry |
| GA 资源目录 / GA resources | 内核资源 / Engine resources |
| L1-L4 记忆存储 / L1-L4 memory storage | 记忆存储 / Memory storage（L1-L4 是引擎行话，教程正文保留） |
| CPython x · 已附带 GA 依赖 | CPython x · 已附带全部依赖（用户要的是零配置，不是依赖来源） |
| Galley 内置 · 已附带 GA 依赖，零配置可用（Runtime 页） | Galley 内置 · 已附带全部依赖，零配置可用 |

同步点：`onboarding-validation.ts` 的 `DEFAULT_HEALTH_CHECK_LABELS`
兜底副本一并更新。**保留不动**：managed 首屏 `modelWelcome`（本就无
GA）、attach 全流程（attachTitle / gaPathLabel / healthTitle /
healthSubtitle 不修改承诺 / loadablePython / 教程文案）、advanced 入口
`接入已有 GenericAgent`（它就是 GA 之门）。

## 验证

`pnpm --dir gui typecheck` + `lint` + `git diff --check` 全过；
`已附带 GA 依赖 / GA 入口模块 / L1-L4` 全库 grep 清零（教程正文的
attach 语境 GA 除外，规则允许）。视觉验收留 owner dogfood。

## Rejected

- **「引擎」作中文称谓**——「内核」在中文浏览器语境更成熟；英文版反用
  engine（各语言取本语言的原生心智，概念一致、词各自原生）。
- **managed health 条目彻底去组件名**（如「入口模块」）——过度模糊伤
  诊断力；「内核」保留了组件语义又不暴露上游名。
- **tagline 补新修饰语**——austerity：删完不补。
