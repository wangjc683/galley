# Galley 远程模块外部事实调研（2026-10-10）

> 访问日期一律 2026-10-10。Apple 文档页没有版本号，标「访问日」。「推理」是我从事实推出来的，不是来源原话。「未核实」是没找到一手来源或来源互相矛盾。

## 1. Noise Protocol Framework

来源：规范 rev 34，2018-07-11，状态 official/unstable。https://noiseprotocol.org/noise.html ，原文 https://github.com/noiseprotocol/noise_spec/blob/master/noise.md

### 1.1 相关模式与性质（规范 §7.7 载荷性质、§7.8 身份隐藏）

规范的性质表只覆盖非 psk 模式。§9 没有给 psk 变体性质表。

| 模式 | 消息 | 源认证 / 目的机密（规范编号） | 要点 |
|---|---|---|---|
| NN | `-> e` / `<- e, ee` / 传输 | 0/0、0/1、0/1 | 无认证。传输层有 ee 前向保密，但可能发给主动攻击者 |
| KK | `-> e, es, ss` | 1/2 | 目的 2：「forward secrecy for sender compromise only, vulnerable to replay」 |
| KK | `<- e, ee, se` / 传输 | 2/4、2/5 | 目的 5 = 强前向保密 |
| XX | `-> e` / `<- e, ee, s, es` / `-> s, se` / 传输 | 0/0、2/1、2/5、2/5 | 三消息往返，双方 static 都在握手里传 |
| IK | `-> e, es, s, ss` / `<- e, ee, se` / 传输 | 1/2、2/4、2/5 | 首消息可重放、无接收方前向保密 |

身份隐藏（发起方 / 响应方，§7.8）：
- XX = 8/1：发起方 static 在前向保密下发给已认证方；响应方 static 能被匿名发起方探测。
- IK = 4/3：发起方 static 加密给响应方 static，没有前向保密。
- KK = 5/5：双方 static 都不传输，但被动攻击者能核对候选密钥对。

psk 机制（§9.2–9.4）：
- `psk0` 在第一条消息开头放 `psk` token，`pskN` 放在第 N 条消息末尾。
- 处理 psk token 时调用 `MixKeyAndHash(psk)`。在 psk 握手里，每次 `MixHash(e.public_key)` 之后都要再调用 `MixKey(e.public_key)`。
- 有效性规则：处理 psk 之后，必须先发出过 `e`，才能发送加密数据。
- 规范推荐的交互式 psk 模式包括 `NNpsk0`、`NNpsk2`、`XXpsk3`、`KKpsk0`、`KKpsk2`、`IKpsk1`、`IKpsk2` 等。
- 规范说任何 psk 修饰符都能「safely applied to any previously named pattern」。
- 生产实例：WireGuard 用的是 `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s`，PSK 可选，不配时默认全零 32 字节。握手首消息带 TAI64N 时间戳防重放，传输层用 64 位计数器加约 2000 的滑动窗口。来源：https://www.wireguard.com/protocol/

推理（从上面机制推出，不是规范原话）：
- **NNpsk0**：第一条消息的载荷只用 PSK 加公开的 `e.pub` 派生的密钥加密，所以没有前向保密，可以被重放。好处是响应方不做 DH 就能凭 AEAD 标签拒绝不持有 PSK 的发起方。第二条消息之后，ee 提供被动前向保密，双方都确认对方持有 PSK。
- **NNpsk2**：第一条消息完全未认证。PSK 认证要到第二条消息末尾才完成。
- **XXpsk3**：PSK 在最后一步才混入。双方 static 在首次接触时由 PSK 担保，适合扫码配对。
- **KK / IKpsk2**：需要事先知道对方 static，适合配对之后的常规会话。

另有 Noise Explorer 的 ProVerif 形式化分析，例如 https://noiseexplorer.com/patterns/IKpsk2/ 。但它给 IKpsk2 消息 A 的评分是 0,0，和规范 IK 表的 1/2 不一致，页面也没解释评分含义。**这一点未核实，别拿它当依据。**

### 1.2 规范对 PSK 的要求

- §9：「both parties have a 32-byte shared secret key」，`psk` 是「a 32-byte secret value」。
- §14：「Pre-shared symmetric keys must be secret values with 256 bits of entropy」。
- §15.1：长度固定，就是为了「deter users from mistakenly using low-entropy passwords as pre-shared keys」。
- §14 PSK reuse：「A PSK used with Noise should be used with a single hash algorithm. The PSK should not be used outside of Noise」。**这条直接影响推送加密，见第 9 节。**
- 其他相关条款：
  - 消息不超过 65535 字节（§3）。
  - nonce 不得回绕，最多 2^64−1 条消息（§14）。
  - 截断攻击由应用负责（§13 Session termination）。
  - 推荐用允许填充的载荷格式（§13 Padding）。
  - 协商数据要防回滚，应该进 prologue（§13、§14 Rollback；§6 说 prologue 不一致时握手失败）。

## 2. Rust 实现

### snow

- 版本：最新 **0.10.0**（crates.io，2025-07-19）。MSRV 1.85，Rust 2024 edition。
- 维护：仓库 https://github.com/mcginty/snow ，1103 星，48 个 open issue/PR。main 最近提交 2026-03-25（依赖升级，包括「require aes-gcm that doesn't have a rustsec vuln」），pushed_at 2026-07-06。116 个反向依赖，其中 rust-libp2p 的 `libp2p-noise` 依赖 `snow 0.10`。
- 规范与模式：README 说跟踪 rev 34，除 `fallback` 修饰符外全部实现，psk 在内。
- 原语：
  - 默认纯 Rust resolver 支持 25519、AESGCM、ChaChaPoly、SHA256、SHA512、BLAKE2s、BLAKE2b，另有非规范的 P-256、XChaChaPoly、BLAKE3。
  - `ring` resolver 支持 25519、AESGCM、ChaChaPoly、SHA256、SHA512，**不含 BLAKE2**。
  - Builder API：`.psk(location, &[u8; 32])`（类型层面强制 32 字节）、`.prologue()`、`.fixed_ephemeral_key_for_testing_only()`。
- 审计：README 原话「This library has not received any formal audit.」
- 已知问题：
  - RUSTSEC-2024-0011（CVE-2024-58265，GHSA-7g9j-g5jg-3vv3）：有状态 `TransportState` 里，未通过认证的载荷也会推进 nonce，可被注入垃圾数据造成 DoS。0.9.5 修复。
  - 0.9.6（2024-01-26）：校验 psk 位置；transport 模式下 `read_message` 硬性限制 65535。
  - 仍 open 的 issue：#203、#99 TransportState、CipherState、Keypair 没有 zeroize；#138 加密和解密两半不能拆开；#51 不能保存或恢复会话密钥；#104 大载荷需要自己分片。
  - 来源：https://rustsec.org/advisories/RUSTSEC-2024-0011.html 、GitHub releases 与 issues（访问日）。

### 备选

- **noise-protocol / noise-rust-crypto**（https://github.com/blckngm/noise-rust ，原 sopium）
  - noise-protocol 0.2.1，2026-03-11；配套 noise-rust-crypto 0.6.2，2023-11-14。73 星。
  - 支持 rev 34、`no_std`，README 称通过了 cacophony 和 snow 的测试向量。没有审计声明。
- **clatter**（https://github.com/jmlepisto/clatter ）
  - 2.3.0，2026-08-30，MSRV 1.81，44 星，近期活跃，main 上已有「3.0 baseline」。
  - 主打 `no_std` 和后量子（PQNoise / ML-KEM）。不支持运行时解析模式名，也不支持 fallback。
  - README 写明「has not received any formal audit」，并且建议「If you don't need PQ functionality … better off using snow」。

## 3. Swift / iOS

### 3.1 CryptoKit 原语与最低版本

数据来自 Apple 文档 JSON（访问日）。

| 原语 | 类型 | 最低 iOS |
|---|---|---|
| X25519 | `Curve25519.KeyAgreement` | 13.0 |
| ChaChaPoly | `ChaChaPoly`，`seal(_:using:nonce:authenticating:)` 支持显式 nonce 和 AAD | 13.0 |
| AES-GCM | `AES.GCM` | 13.0 |
| SHA256 | `SHA256` | 13.0 |
| HMAC | `HMAC` | 13.0 |
| HKDF（独立类型） | `HKDF` | **14.0** |
| HKDF（挂在 SharedSecret 上） | `SharedSecret.hkdfDerivedSymmetricKey` | 13.0 |
| HPKE（RFC 9180） | `HPKE` | **17.0** |

补充：
- CryptoKit **没有 BLAKE2**。旁证：trancee/noise-protocol 为 iOS 另外内嵌了一份 C 版 BLAKE2。所以要选 `_SHA256` 套件。
- `SharedSecret` 遵循 `ContiguousBytes`，能取出原始 DH 输出，Noise 需要这一点。
- Noise 的 HKDF 等于「以 chaining_key 为 salt、info 为空的 RFC 5869」（规范 §4.3），用 `HMAC<SHA256>` 在 iOS 13 上就能实现。
- 全零 DH 输出：swift-crypto 源码注释说「CryptoKit on Apple platforms currently does not」拒绝全零共享密钥（`Sources/Crypto/Keys/EC/BoringSSL/X25519Keys_boring.swift`，main 分支）。规范 §12.1 允许不拒绝。
- nonce 编码：ChaChaPoly 是 32 位零加 64 位**小端**计数器，AESGCM 是**大端**（规范 §12.3、§12.4）。

### 3.2 Swift 版 Noise 实现

用 GitHub API 搜索，访问日 2026-10-10。

| 仓库 | 星 | 最近提交 | 测试向量 | 评价 |
|---|---|---|---|---|
| swift-libp2p/swift-noise | 4 | 2026-08-08 | 有，NN、XX、IK、KK 等，含 psk0–3 | **最可用**，见下 |
| samueltangz/swift-noise-protocol | 10 | 2021-04 | — | 停更 |
| nixberg/noise-swift | 0 | — | — | README 写「Do not use」 |
| trancee/noise-protocol | 0 | 2026-03 | 自带 JSON 向量 | 声称 38+ 模式、iOS 与 Android 双端，新且无人用 |

swift-libp2p/swift-noise 详情：
- 最新 tag 0.1.1，MIT，只有 1 个贡献者，bus factor 低。
- 依赖 swift-crypto ≥4.0（在 Apple 平台上委托给 CryptoKit），最低 iOS 13。
- 支持 15 个基本模式、psk0–psk3、ChaChaPoly 与 AESGCM、SHA256/384/512。
- README 称「Validated against the official Noise test vectors」。测试文件里有 `Noise_NNpsk0/2`、`XXpsk3`、`IKpsk2`、`KKpsk0/2_25519_ChaChaPoly_SHA256` 等。
- 向量是 `key=value` 文本格式，不是 cacophony 的 JSON。具体来源没写，**未核实**。

自研可行性（推理）：Noise 的核心状态机（CipherState、SymmetricState、HandshakeState）规范 §5 有完整伪代码。所需原语 CryptoKit 在 iOS 13 上都有，只要选 SHA256 套件。自研规模不大，关键是用测试向量锁死正确性。

### 3.3 测试向量

- noise_wiki 的 Test vectors 页（最后编辑 2017-10-06）定义了 JSON 格式：`protocol_name`、`init_prologue`、`init_psks`、`init_ephemeral`、`init_static`、`init_remote_static`、`messages[{payload,ciphertext}]`、`handshake_hash` 等。它列出的来源有 cacophony、noise-c、snow-multipsk。https://github.com/noiseprotocol/noise_wiki/wiki/Test-vectors
- **cacophony.txt**（https://github.com/haskell-cryptography/cacophony ，原 centromere）：
  - 944 条向量，文件最近改动 2018-12-16。
  - 对 `25519_ChaChaPoly_SHA256` 覆盖 NN、NNpsk0、NNpsk2、XX、XXpsk3、IK、IKpsk1、IKpsk2、KK、KKpsk0、KKpsk2、Npsk0、Kpsk0、Xpsk1 等，这是我本地下载后统计的。
  - snow 的 `tests/vectors.rs` 直接 `include_str!("vectors/cacophony.txt")` 跑这份向量。
  - snow 自带的 `snow.txt`、`snow-extended.txt` 是 snow 自己生成的，psk 部分是多 psk 组合（如 `NNpsk0+psk2`）。
- 能不能用于 CI 互通校验：能。
  - Rust 侧照 snow 的写法跑 cacophony JSON。snow 有 `fixed_ephemeral_key_for_testing_only` 可以固定临时钥。
  - Swift 侧写同格式的 JSON 解析测试。
  - 两边用同一份向量，再加一条「Rust 发起、Swift 响应」的固定临时钥端到端用例，就能锁死互通。

## 4. APNs

Apple 文档，访问日 2026-10-10。

### 4.1 载荷大小

一般推送上限 **4 KB（4096 字节）**，VoIP 为 5 KB（5120 字节）。超限返回 413 `PayloadTooLarge`。JSON 不得压缩。
- https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

### 4.2 Token 认证

来源：https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns

- 密钥：`.p8` 签名密钥，加 10 位 Key ID 和 Team ID。
- JWT：header 为 `alg: ES256`（「APNs supports only the ES256 algorithm」）和 `kid`；claims 为 `iss`（Team ID）和 `iat`。
- 刷新间隔：「Refresh your token no more than once every 20 minutes and no less than once every 60 minutes」。
- 相关错误：
  - `iat` 超过 1 小时：403 `ExpiredProviderToken`。
  - 刷新过频：429 `TooManyProviderTokenUpdates`。
- 新增的 key 类型：
  - team-scoped key 可以限定只用于 Sandbox 或 Production，每个环境最多 2 把。
  - topic-specific key 每个环境最多 200 把。

### 4.3 端点

- 要求 HTTP/2 加 TLS 1.2 及以上。
- 生产：`api.push.apple.com:443`；沙盒：`api.sandbox.push.apple.com:443`。两者都可改用 2197 端口。
- 路径：`POST /3/device/<hex token>`。
- 官方建议：
  - 长期复用连接，「hours to days」，空闲 1 小时可以发 PING。
  - 必须用 HPACK。
  - 不要假设 device token 的长度。

### 4.4 mutable-content 与 Notification Service Extension

- 触发条件：`aps.mutable-content: 1`，并且这条推送配置为显示 alert。静音推送、只有声音或角标的推送不会进 NSE。
- 时限：「no more than 30 seconds」。超时会调用 `serviceExtensionTimeWillExpire()`。来源：`didReceive(_:withContentHandler:)` 文档。
- 解不开或超时：两种情况系统都会显示**原始内容**（「the system displays the original contents of the notification」）。Apple 的示例代码就是解密失败时把正文写成「(Encrypted)」。来源：https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications
- 修改后不能去掉 alert 文本，否则修改会被忽略。
- 内存：官方文档没写数字。Apple DTS 工程师在论坛（2024-12）说「The extension will be limited to 30 seconds and 24 MB total memory」，同帖也说后台推送会被节流。来源：https://developer.apple.com/forums/thread/770880 。社区帖反映超内存被 jetsam 杀掉时同样显示原文，且不回调 expire。**这一点只是社区报告，未核实。**
- 静默过滤：`com.apple.developer.usernotifications.filtering`（iOS 13.3+）需要向 Apple **申请**。有了它，NSE 返回空的 `UNNotificationContent` 就能静默丢弃这条推送。没有这个 entitlement 就做不到。

### 4.5 请求头

| 头 | 要点 |
|---|---|
| `apns-collapse-id` | 不超过 **64 字节**，超长返回 400 `BadCollapseId` |
| `apns-priority` | 10 立即（缺省值）；5 按设备电量策略；1 优先省电且不唤醒设备。5 和 1 可能被合并成批投递 |
| `apns-push-type` | iOS 上「recommended」（watchOS 必填）。必须和载荷一致，不一致可能报错、延迟或丢弃。`background` 类型必须用 priority 5 |
| `apns-expiration` | 0 表示只尝试一次。离线时每个 bundle ID 只存一条，多数情况是最新那条 |

### 4.6 中断级别

- 载荷写 `aps.interruption-level`，取值 `passive`、`active`、`time-sensitive`、`critical`。`UNNotificationInterruptionLevel.timeSensitive` 自 iOS 15。
- time-sensitive：WWDC21 session 10091 原话「enable the associated capability via Xcode」。Apple 的「Supported capabilities (iOS)」列有 Time Sensitive Notifications。官方没说需要审批。
  - entitlement 键名 `com.apple.developer.usernotifications.time-sensitive` 只见于二手文档（DashX、Pushwoosh），Apple entitlements 索引里没有这个条目。**键名未核实。**
- critical：WWDC21 原话「will continue to require an approved entitlement」，需要填申请表。

### 4.7 无效 token 与错误码

来源：https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns

- **410**：`Unregistered`（「inactive for the specified topic」）或 `ExpiredToken`。响应 JSON 带 `timestamp`，表示 token 失效的时间（毫秒）。
- 400 `BadDeviceToken`：常见原因是 token 环境不匹配。
- 不要重试的错误：`BadDeviceToken`、`DeviceTokenNotForTopic`、`Forbidden`、`ExpiredToken`、`Unregistered`、`PayloadTooLarge`。
- 5xx 可以在 15 分钟后退避重试。
- 4xx 多了会拖慢发送，错误过多会被断开连接；410 不算错误。

### 4.8 速率限制

- 官方**没有公布全局数值**。
- 对单个 device token 连续发送过多会返回 429 `TooManyRequests`，可以延迟重试。
- 后台（`content-available`）推送「don't try to send more than two or three per hour」，会被节流。来源：https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app
- 与限速相关的避坑提示（Threema 的 apns-h2 README）：
  - 不要每个请求都新开连接，否则会被当成 DoS 封 IP。
  - 对失效 token 持续发送可能导致 ConnectionError。

### 4.9 Rust 侧

- **a2**：
  - crates.io 最新 0.10.0（2024-05-05）。仓库已迁到 https://github.com/reown-com/a2 ，174 星，23 个 open issue。
  - 默认分支最后一次提交仍是 2024-05-05，依赖 rustls 0.22 这类旧版本。
  - 支持 `.p8` token 自动续签，加密后端可选 openssl 或 ring。
  - 结论：**基本停更**。
- **apns-h2**（Threema 从 a2 分叉，https://github.com/threema-ch/apns-h2 ）：
  - 0.11.0（2026-02-09），MSRV 1.88，后端可选 openssl 或 AWS-LC。
  - 用于 Threema 的 push-relay 生产环境，是活跃的替代。
- **自己写**：reqwest 0.13.5（2026-09-08）默认 feature 含 `http2` 和 rustls；jsonwebtoken 11.1.0（2026-09-16）。要点：
  - jsonwebtoken 需要显式选 `aws_lc_rs` 或 `rust_crypto` 后端。
  - EC 私钥只支持 PKCS#8。`.p8` 本身就是 PKCS#8，所以可以用 `EncodingKey::from_ec_pem`。
  - header 要带 `kid`，claims 只要 `iss` 和 `iat`。
  - JWT 按 20–60 分钟窗口缓存复用，单个 HTTP/2 连接长期复用。
  - 410 时删除对应 token。

## 5. iOS 后台与 WebSocket

- 进后台时 `applicationDidEnterBackground` 只有 **5 秒**，之后「Shortly after」进入挂起。用 `beginBackgroundTask` 可以延长。来源：https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
- 延长能拿到多久：Quinn（DTS）说「On current systems you can expect about 30 seconds」，并强调没有保证，可能随时到期。帖子首发 2017-08-17，修订 2023-06-16。来源：https://developer.apple.com/forums/thread/85066
- 关键在挂起不在后台：「not foreground/background but running/suspended」（Quinn，2022-09，https://developer.apple.com/forums/thread/716118 ）。挂起后代码不跑，socket 资源可能被回收，之后所有操作都失败。来源：TN2277，2011，已归档，https://developer.apple.com/library/archive/technotes/tn2277/_index.html ；Quinn 2019 年说「On current system, it runs as soon as your app get suspended」。
- 官方推荐用推送：「There isn't a general-purpose way to prevent your app from being suspended … transition from using a network connection to hear about new events to using push notifications」。来源：Quinn，2019-06，https://developer.apple.com/forums/thread/117150
- 具体表现：后台时 `URLSessionWebSocketTask.receive()` 报 `ECONNABORTED`（2025-04 论坛帖）。
- API 选择：Quinn 建议改用 Network framework。TN3151 原话「Unless you have a specific reason to use URLSession, use Network framework for new WebSocket code」。
  - `NWProtocolWebSocket` 自 iOS 13 可用；新的 `NetworkConnection` 加 `WebSocket` 是 iOS 26。
  - 来源：https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api
- 「多久断开」：**官方没有给出确切时长**。能确定的只有上面这些：挂起前约 5 秒；后台任务大约 30 秒，不保证；挂起后连接随时可能失效。

## 6. Caddy 反代 WebSocket

当前最新 Caddy 是 v2.11.7（2026-10-03）。

- **WebSocket 支持**：reverse_proxy 自动支持，原话「performing the HTTP upgrade request then transitioning the connection to a bidirectional tunnel」，无需额外配置。2.9 到 2.11 期间加了 HTTP/2、HTTP/3 extended CONNECT 下的 WebSocket 处理。
- **reload 行为**：
  - 原话「By default, WebSocket connections are forcibly closed (with a Close control message sent to both the client and upstream) when the config is reloaded」。原因是每个请求都持有旧配置的引用。
  - 这个行为从 v2.6.0（2022-09-20，#4895）开始。
  - 来源：docs 源码 `reverse_proxy.md`，https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- **`stream_close_delay`**：
  - 配置卸载（reload）时，把强制关闭推迟到延时结束，用来避免「thundering herd」重连。文档建议起步值 `5m`，默认不延迟。
  - 版本：PR #5567（2023-06-19 合入）。经 GitHub compare 确认 **v2.7.0（2023-08-02）首次包含**，v2.6.4 不含。v2.7.3 的 release notes 标为 EXPERIMENTAL。
- **`stream_timeout`**：流式请求（如 WebSocket）超过该时长就强制关闭，文档建议 `24h`，默认不超时。同样来自 #5567。
- **新风险**：
  - v2.11.6（2026-10-01）新增**默认 1 分钟**的 `read_body_idle` 和 `write_idle` 空闲读写超时（#7913，防 slowloris）。
  - v2.11.7（2026-10-03）修复了「streams that were cut off after a minute」等回归。
  - 这组超时对已 hijack 的 WebSocket 是否生效，文档和源码里我都没找到明确结论。**未核实。**
- **访问日志默认关闭**：源码 `modules/caddyhttp/server.go` 注释「Enables access logging … To minimally enable access logs, simply set this to a non-null, empty struct」，也就是不配 `log` 指令就不记访问日志。
  - 开启后会记录 `request>uri`、`remote_ip`、`client_ip`、请求头。`Cookie`、`Set-Cookie`、`Authorization`、`Proxy-Authorization` 默认记为 `REDACTED`。
  - 运行时日志（非访问日志）默认输出到 stderr。

## 7. 压缩与加密

- **事实**：
  - CRIME（CVE-2012-4929）攻击的是 TLS 层压缩；TIME 和 BREACH 攻击的是 HTTP 层压缩。RFC 7457 §2.6 说 BREACH「not aware of mitigations at the TLS protocol level」，只能在应用层缓解。
  - RFC 9325 §3.3：TLS 1.2 SHOULD NOT 压缩；TLS 1.3 已经移除压缩（RFC 8446）。
  - RFC 9113（HTTP/2）§10.6：「MUST NOT compress content that includes both confidential and attacker-controlled data unless separate compression dictionaries are used for each source」，以及「Compression MUST NOT be used if the source of data cannot be reliably determined」。
  - RFC 7692（permessage-deflate）§8 只有一句提醒：「known exploit when history-based compression is combined with a secure transport [CRIME]」。§7.1.1 定义了 `*_no_context_takeover` 参数，可以禁止跨消息复用滑动窗口。
  - OpenVPN 手册：「If an attacker knows or is able to control (parts of) the plain-text of packets that contain secrets … might be able to extract the secret if compression is enabled … VORACLE」，因此「compression support was removed from current versions」，只解压不压缩。来源：`doc/man-sections/protocol-options.rst`，最近改动 2025-12-08。
  - 填充的现成做法：
    - Signal-Android 把消息填充到 **80 字节的整数倍**（`PushTransportDetails.java`，`PADDING_BLOCK_SIZE = 80`，文件最近改动 2026-06-09）。
    - Padmé（PURBs，PoPETS 2019）把长度泄露压到 O(log log M) 位，额外开销不超过 12%。https://petsymposium.org/popets/2019/popets-2019-0056.php
    - TLS 1.3 §5.4 有 record padding，附录 E.3 承认 TLS 不防长度和时序分析。
    - Noise 规范 §13 也推荐用支持填充的载荷格式。
- **对本设计的风险评估（推理）**：
  - 「先压缩、再端到端加密」时，relay 能看到每帧密文长度。agent 读取的网页内容攻击者可控，如果和密钥、cookie、用户隐私落在同一个压缩上下文里（例如同一条工具结果，或开了 context takeover 的同一条流），就满足 BREACH、VORACLE 的前提。
  - 实际利用需要攻击者能自适应地多次触发重读，门槛比浏览器场景高，但规范级结论（RFC 9113 的 MUST NOT、OpenVPN 移除压缩）是：无法可靠区分数据来源时就不压缩。
  - 截图这类图片本来就压缩过，不压缩几乎没有带宽损失。
  - 在密文外层开 permessage-deflate 没有安全风险，但压不动密文，白耗 CPU，可以关掉。

## 8. 同类产品

- **Tailscale DERP**：
  - 原话「A DERP server blindly forwards already-encrypted traffic from one device to another」，「impossible for a DERP server to decrypt your traffic」。来源：https://tailscale.com/kb/1232/derp-servers ，页面标 Last validated 2026-01-21。
  - 源码 `derp/derp.go`：「DERP routes packets to clients using curve25519 keys as addresses」，是在直连失败时才用的最后手段。
- **Syncthing relay**：原话「The connection between two devices is still end to end encrypted」，「the relay only retransmits the encrypted data」。relay 运营方能看到 IP、设备 ID 和流量大小。来源：https://docs.syncthing.net/users/relaying.html ，文档写于 v2.1.0。
- **Happy（slopus/happy，24k 星，2026-10-10 仍活跃）**：
  - 服务器只是加密 blob 的中继，设计目标是「Keep the server blind to user content」。
  - 两种加密：legacy 用 NaCl secretbox（XSalsa20-Poly1305，32 字节共享密钥）；dataKey 用 AES-256-GCM，按会话的数据密钥再用 `tweetnacl.box` 加临时密钥对包裹。
  - 时间戳是明文，部分第三方 token 只在服务端加密，不是端到端。
  - 来源：`docs/encryption.md`，最近改动 2026-01-29。
  - **推送不是端到端加密**：CLI 先从服务器取 push token，再经 Expo Push API 发**明文** title/body，title 如「Permission request」，body 是会话摘要或目录名。来源：`packages/happy-cli/src/api/pushNotifications.ts`，提交 1862c2c886，2026-08-04。
- **Anthropic Claude Code Remote Control**：
  - 本地只发出站 HTTPS，原话「All traffic travels through the Anthropic API over TLS」，用多个短期、单一用途的凭据。不是对 Anthropic 端到端加密，好在 Anthropic 本来就是模型方。
  - 每台设备单独登记凭据，在「Trusted devices」里可以即时吊销。这是 P1 设备吊销可以对照的现成形态。
  - 推送支持「在电脑前就不推」（`CLAUDE_CLIENT_PRESENCE_FILE`）。
  - 来源：https://code.claude.com/docs/en/remote-control （访问日）。
- **Signal（推送不带内容）**：
  - Signal-Server 的 `APNSender.java`（2026-05-20）里，普通消息推送只有 `mutable-content` 加本地化占位文案 `APN_Message`，collapse-id 固定为 `incoming-message`，TTL 30 天。也就是推送里**完全没有消息内容**。
  - NSE 再去服务器拉取并解密是 Signal-iOS 的做法，这次没核对 Signal-iOS 源码。**未核实。**

## 9. 对设计的建议

每条后面注明依据来自上文哪一节。

1. **P0 握手：`Noise_NNpsk0_25519_ChaChaPoly_SHA256`**。手机做发起方，桌面 Core 做响应方。
   - 选它的理由：只需要 PSK；响应方不做 DH 就能在第一条消息上拒绝不持有 PSK 的连接；传输层有 ee 前向保密（§1.1）。
   - **第一条消息载荷留空**，因为它可以被重放、没有前向保密（§1.1 推理，规范目的性质 2）。
   - prologue 写入协议版本、角色和设备 ID，用来防回滚（§1.2）。
2. **P1 升级路径**：
   - 配对用 `XXpsk3`。二维码给出一次性 32 字节随机配对密钥，用它担保双方首次交换的 static（§1.1）。
   - 常规会话用 `KK`，或者加一层可选的每设备 PSK 做纵深防御，即 `KKpsk2`，仿照 WireGuard 的 `IKpsk2`。
   - 吊销就是把该设备的 static 从白名单里删掉。P0 的共享 PSK 只能整体轮换、全部设备重新配对（§1.1、§8 Remote Control）。
   - 设备 ID 本来就在 relay 的路由元数据里，所以 IK 的身份隐藏优势用不上，KK 更简单。如果更看重「已被 WireGuard 验证过」，选 `IKpsk2` 也合理。
3. **密钥材料**：二维码里放 32 字节高熵随机主密钥，不能是口令（§1.2、§15.1）。用 HKDF 以不同 label 分别派生 Noise PSK 和推送密钥，**不要把 Noise PSK 直接拿去做推送加密**（规范 §14「The PSK should not be used outside of Noise」）。relay 的接入凭据也要和端到端密钥分开。
4. **库**：
   - Rust 用 `snow 0.10.0`。要求至少 0.9.5，原因是 RUSTSEC-2024-0011。套件选 25519、ChaChaPoly、SHA256，默认 resolver 或 ring 都支持（§2）。
   - Swift 用 CryptoKit 原语自研一个很薄的 Noise，或者 vendor swift-libp2p/swift-noise 并锁定提交。只要 SHA256 套件，iOS 13 即可（§3.1、§3.2）。
   - CI 两侧共用 cacophony.txt 向量，再加一条固定临时钥的 Rust↔Swift 互通用例（§3.3）。
5. **推送加密**：
   - **P0**：
     - 桌面用推送密钥对 `{seq, ts, 内容}` 做 ChaChaPoly 加密，填充到固定桶长（例如 2048 字节），base64 后放进自定义键，保证整体小于 4096 字节（§4.1、§7）。
     - `aps.alert` 放通用占位文案，同时设 `mutable-content: 1`，因为 NSE 失败或超时会显示原文（§4.4）。
     - NSE 在 App Group 里记录已收到的最大 seq，拒绝 relay 重放的旧推送。
     - collapse-id 用不透明值，不超过 64 字节（§4.5）。
   - **P1**：手机生成每设备的推送 X25519 密钥，公钥经 Noise 通道交给桌面。桌面用 HPKE（CryptoKit iOS 17 及以上；Rust `hpke` 0.14.1，未审计）或 Noise 单向模式 `Kpsk0`/`N` 加密。这样桌面被攻破也解不开旧推送，吊销时删掉公钥和 token 即可（§3.1、§1.1）。
   - 推送不能复用 snow 的会话密钥，因为 snow 不能序列化会话（#51），NSE 也拿不到会话状态（§2）。
6. **NSE 工程坑**：
   - 推送密钥存进共享 keychain access group，accessibility 设为 `AfterFirstUnlock`。否则锁屏时或重启后还没首次解锁时 NSE 读不到密钥，只能显示占位文案（§4.4，Apple 文档 kSecAttrAccessibleAfterFirstUnlock）。
   - NSE 的预算按 30 秒、24 MB 算（§4.4）。
   - 没有 filtering entitlement 就无法静默丢弃推送（§4.4）。
   - time-sensitive 只需要开 capability；critical 需要申请（§4.6）。
7. **APNs 发送端**：
   - 用 apns-h2，或 reqwest 加 jsonwebtoken 自己写，不选停更的 a2（§4.9）。
   - ES256 JWT 每 20–60 分钟换一次，HTTP/2 连接长期复用（§4.2、§4.3）。
   - 收到 410 就删除 token，并且不要对失效 token 重试（§4.7）。
   - alert 类推送用 priority 10，可选 time-sensitive（§4.5、§4.6）。
8. **Caddy**：
   - 配 `stream_close_delay`（例如 5m）。客户端重连带指数退避和抖动（§6）。
   - Caddy 至少升到 2.11.7，应用层心跳不超过 30 秒。这样既能避开不确定的 idle 超时（§6，未核实项），也能及时发现手机已经挂起（§5）。
   - 鉴权放请求头，不要放在 URL query 里，以防日后开了访问日志被记录（§6）。
9. **iOS 连接策略**：
   - 前台走 WebSocket；进入后台后视为随时会断，靠推送唤醒用户。
   - relay 用心跳判断手机已经离线，改走推送（§5）。
   - 新代码按 Apple 的建议用 Network framework 写 WebSocket，不用 `URLSessionWebSocketTask`（§5，TN3151）。
10. **压缩**：端到端层不压缩，按桶长填充。WebSocket 层的 permessage-deflate 关掉（§7）。
11. **分帧**：单条 Noise 消息不超过 65535 字节，大载荷由应用层分片。会话结束要显式发结束标记，用来防截断（§1.2、§2）。
12. **snow 的工程限制**：没有 zeroize（#203、#99）；加密和解密两半拆不开，全双工要加锁（#138）。在 WebSocket 这种有序流上用有状态的 `TransportState` 就够了，不需要无状态版本加滑动窗口（§2）。
