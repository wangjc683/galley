# 远程访问：协议设计稿与第一批实现（2026-10-10）

> 接 [移动端产品定义](./2026-10-09-mobile-product-definition.md) 与 [iOS 原生客户端方向](./2026-10-09-ios-client-and-main-chat-direction.md)。
> 设计稿是 [`.scratch/ios-client/issues/05-remote-protocol-design.md`](../../.scratch/ios-client/issues/05-remote-protocol-design.md)，
> 外部调研是 [`.scratch/ios-client/research/2026-10-10-remote-protocol-external-facts.md`](../../.scratch/ios-client/research/2026-10-10-remote-protocol-external-facts.md)，
> 裁决记在 [iOS PRD](../../.scratch/ios-client/PRD.md) 22–24。本文只记「为什么」和否掉的路。

## 结论

- 票 02 的 P0 部分（02a–02d，Core 接管发送 + 所有写入都广播）上午合完，下午转入远程访问。
- 仓库布局：iOS App 与 relay 的源码都进 galley 单仓，iOS 端随仓以 MIT 开源（裁决 22）；relay 的部署归私有的 inkstone-ops（裁决 23）。
- 协议设计稿五个裁决点（裁决 24）：P0 握手用 `Noise_NNpsk0_25519_ChaChaPoly_SHA256`、P1 再升 `XXpsk3` + `KK`；手机侧 Noise 用 CryptoKit 自己写；
  推送端到端加密、显示真实内容；原票 03（`client` 列）与「轮次落库广播」并进 05；relay 域名一项撤销。
- 当天合入五张实现票：05a 协议 crate `remote-protocol/`、05c Core 缺口、05b Core 远程模块 `core/src/remote/`、06a relay `relay/`、07a Swift 协议包
  `ios/GalleyRemote/`。06b（APNs）进行中；05d（设置「手机」页）、06c（部署）未开。

## 裁决与否掉的路

- **单仓开源**。理由：裁决 14、16 要 CI 在同一提交里核对桌面生成的 token、文案与一致性语料；三方协议（Core、relay、iOS）要能原子改动；
  端到端加密的承诺要客户端与 relay 都开源才可审计。否：iOS 单独私有仓（token、语料、协议都要跨仓同步）；relay 与 iOS 各自独立仓。
- **relay 部署归 inkstone-ops**，是该仓「租户部署归租户仓」的例外：galley 是公开仓，部署细节属于砚石的实例而不是产品。inkstone-ops 的 `CLAUDE.md`
  边界一节同日补了这条例外。
- **握手先简后升**（A）。否 B「P0 直接 XXpsk3 配对 + KK + 设备白名单」：P0 只有 JC 一台手机，吊销需求还不存在；协议版本写进 prologue，升级不会被降级，
  迁移时重扫一次码。
- **手机侧 Noise 用 CryptoKit 自写**（A）。JC 先问「什么是 iOS 侧的 Noise」，补解释时发现初稿漏了选项 C：把 Rust 的实现编译进 App、Swift 经 UniFFI 调用
  （Signal 的 `libsignal`、Element X、Firefox iOS 的先例）。否 C：iOS 构建会永久带上 Rust 工具链和 xcframework，JC 的 Mac 是 Intel 还要多一个模拟器目标，
  开源贡献门槛变高；这些先例共享的是整套协议逻辑，我们只有一个握手加帧加密。C 留作出口：线上协议与实现方式无关，共享逻辑变多时再换。
  否 B「vendor `swift-libp2p/swift-noise`」：4 star、1 个贡献者，测试向量来源不明。
- **relay 域名撤销**。JC 指出用户不接触 relay。核对后初稿「App 里会写死地址，以后改要发版」与设计稿自己第 3.1 节「二维码带 `relay=`」矛盾，是我写错了。
  落定：手机只从二维码拿地址；桌面照更新地址的先例在编译期由 CI 变量注入（`core/src/app_update.rs` 的 `option_env!`），砚石实例的域名不进公开源码；
  运行时同名环境变量 `GALLEY_REMOTE_RELAY_URL` 覆盖，开发连本机 relay 用。具体子域在部署票 06c 动 DNS 时再问 JC。
- **通知显示真实内容**（A）。否 B「只显示有新消息」：推送已是端到端加密，锁屏预览交给 iOS 系统设置；只显示占位会让「它来找你」这个场景弱很多。

## 实现里不显然的决定

- **迁移编号用 043 不用 041**：041 从未存在过；已发布的库都在 042，迁移前备份按 `MAX(version)` 比较，补一个 041 会在升级时跳过备份。
- **`client` 不进 CLI JSON**：放在 `Origin.client` 上并 `#[serde(skip)]`，既不序列化也不反序列化，调用方不能冒充；Rule 3 不动。
  Goal 的起始目标也记 `desktop`（人在桌面窗口打的字）。
- **轮次落库广播，GUI 先跳过**：页面自己会在 `turn_end` 时给轮数加一，这条广播来自另一个 Core 任务、可能先到，GUI 再加就重复计数（代理写测试复现了）。
  GUI 忽略 `via: "turn-persist"`，手机照收；统一到这条广播留给 02e。
- **`session-run-state` 只发状态不发边沿**：一个发布任务读最新状态、去重后发，最后一条总是真实状态，代价是瞬间来回的变化可能不出现。
- **golden 文件的 JSON 键按字母排序**：workspace 构建时 CLI 会打开 serde_json 的 `preserve_order`，不排序的话单独构建与整体构建产物不同。
- **推送明文一律填到 2048 字节**：所有推送一样长，relay 从长度看不出内容；APNs 载荷 2871 字节，在 4096 上限内。`seq` 取 `max(上一个 + 1, 当前毫秒)`，
  计数器丢了也不会退回到手机见过的值以下。
- **relay 限速用背压不用断开**：25MB 的图片上传是正常流量；慢接收方 10 秒无进展才断。
- **relay 地址只填基础地址**：连接路径 `/v1/connect` 由两端按 05a 的 `RelayUrl` 自己拼；06a 发现后同步给了正在做的 05b。
- **漂移检查并进 Swift 测试**：Swift 测试直接读 Rust 的 golden 文件，Rust 侧新增任何段、字段、枚举值、方法或事件而 Swift 没跟上就失败，不另写脚本。
- **本机跑 Swift 测试要用 `ios/GalleyRemote/swift-test.sh`**：JC 的 Mac 只有 Command Line Tools，SwiftPM 6.2 不把其中的 Testing.framework 加进测试目标；
  CI 的 macOS 26 有 Xcode，直接 `swift test`。
- **CI 加了 Linux 的 relay job**：relay 正式跑在 frankfurt 的 Debian 上，原有 Core 矩阵只有 macOS 与 Windows。

## 验证

- 每张票在 worktree 里由主会话复跑：05c 全量 722、05a 61、06a 20、07a 74（Swift Testing）、05b 合并 06a 后全量 835，均 0 失败；
  合入主树前都查过 `galley status` 的 `busy:0`，push 前本地跑六个门禁脚本。
- 迁移 043 已应用到 JC 的 dev 库，迁移前自动备份 `app.galley.backup.20261010T084620Z`。
- 远程模块在没配 relay 地址的构建里不创建，dev 与下一个发布在设 CI 变量前行为不变。
- CI：06a / 07a 那一轮的 `Relay (Linux)` 与 `iOS protocol` 两个 job 都绿。

## 未完

- 06b APNs 真发送（假 APNs 服务器测试 + 真 relay 端到端测试），进行中。
- 05d 设置「手机」页：视觉改动，先本地合入不 push、本机起 relay 让 JC 带环境变量重启 dev 预览，看过再 push。
- 06c 部署：等 Apple 开发者账号，与推送密钥一次部署；动 frankfurt 与 DNS 前问 JC。Caddy 对 WebSocket 的空闲超时可先在本机装同版本 Caddy 验。
- 手机 App 本体（票 07 其余部分）按移动端次序，等 10-16 主聊天复盘与第 4 步之后。
