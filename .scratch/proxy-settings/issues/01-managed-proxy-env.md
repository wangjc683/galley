# 网络代理设置(managed 引擎)

Status: needs-triage
日期:2026-07-21
来源:Runtime tab 打磨讨论(JC + agent)

## 问题

桌面应用从 Dock / Finder / 开机自启启动时不继承 shell 环境变量,用户在
终端配好的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`,Galley 引擎进程
(bridge 子进程里的 LLM API 调用)拿不到。症状:"终端里 curl 得通 API,
Galley 里连不上"。国内直连 OpenAI / Anthropic 的用户几乎必然撞上。

现状核实(2026-07-21):代码里没有任何 proxy 相关配置
(`grep -ri proxy core/src runner` 无命中)。Models 的自定义 Base URL
(中转站)只能部分缓解,不覆盖直连 + 代理的用户。

## 方向(待触发后细化)

- 问题域属于 Settings → Runtime(引擎的网络环境),UI 大概率一个输入框
  (代理 URL)+ 可能的 bypass 列表;
- 实现是 bridge spawn 时注入 env(managed 模式;attach 模式下用户自己的
  GA 环境不该被 Galley 改写——Rule 1 边界,需要想清楚 attach 是否适用);
- 待定形态:HTTP / SOCKS 支持范围;全局 vs per-provider;是否读系统代理。

## 触发条件

第一个"应用里连不上 API、终端能连"类用户反馈。在那之前不做——现在做
是在猜需求形态。

## Comments

2026-11-19：上面「现状核实」里「代码里没有任何 proxy 相关配置」已过时。当天起 Core 自己的请求
（测试模型、对话图片、ChatGPT 登录）与应用内更新器都跟系统代理（Windows 注册表、macOS 系统设置；
不读 PAC 与 SOCKS），回环地址的测试模型直连，见
[devlog](../../../docs/devlog/2026-11-19-update-proxy.md)。引擎进程没有动：它用 Python `requests`，
默认按系统代理与例外列表走，这一句是按 `requests` 的行为推的，没有实测。本票的触发条件
（应用里连不上 API、终端能连）不变，GitHub issue #33 说的是更新，不算触发。
