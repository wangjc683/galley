# 05 / 06 — 远程模块与 relay 协议设计稿

Status: ready-for-agent（第 12 节裁决点全部落定，2026-10-10；实现拆分见第 13 节，05a `4b53f751`、05c `01d67d44`、05b `ee3ea6c2`、06a `28601618`、06b `1e483880`、07a `8fb2601b` 已合入；余 05d、06c）

来源：2026-10-10 JC 裁决「iOS 端开源，单仓按建议推进，先出协议设计稿」。上游：PRD 裁决 1、2、6、8、9、17、18、22、23（`../PRD.md`）；
宪法 Rule 2（`AGENTS.md:107-126`）。依据两份调研：

- 代码事实：只读子代理 2026-10-10 盘点，本文引用处都带 `file:line`（以 `0df5de5c..ea5f780d` 之后的 main 为准）。
- 外部事实：[research/2026-10-10-remote-protocol-external-facts.md](../research/2026-10-10-remote-protocol-external-facts.md)，每条附一手来源 URL，
  本文以「外部 §N」引用。

## 结论先行

- **链路**：iOS App ⇄ relay（frankfurt，Caddy 终结 TLS）⇄ Core 远程模块（在 Core 进程内、只向外连 WSS）。TLS 之上再套一层端到端的 Noise 会话；
  relay 只按「频道」转发不透明的帧，外加替桌面代发 APNs 推送。
- **加密**：P0 用 `Noise_NNpsk0_25519_ChaChaPoly_SHA256`，手机发起、Core 响应；预共享密钥来自桌面二维码给的 32 字节配对主密钥，经 HKDF 按用途分别派生。
  P1 升级为 `XXpsk3` 配对加 `KK` 会话，按设备吊销。P0 的协议版本写进 Noise prologue，升级时不会被降级。
- **relay 无状态**：内存里一张「频道 → 连接」表；不存消息、不存设备推送 token（token 由手机经端到端通道告诉桌面，桌面发推送时带上）；
  只记字节数、连接数这类计数。逐条对照 Rule 2 见第 4.1 节。
- **应用层**：端到端通道里跑 JSON 请求 / 响应 / 事件，约十个方法加会话订阅。断线重连就全量重拉会话列表与当前会话的消息尾部；
  事件尽力送达，与 `Notifier` 的既有约定一致（`core/src/notify.rs:16-23`）。
- **推送**：桌面判定「需要关注」后用推送密钥加密内容，经 relay 发 APNs；手机的 Notification Service Extension 解密显示，解不开就显示占位文案。
- **Core 要补五个缺口**（第 7 节）：通知扇出、轮次落库广播、运行状态事件、附件只读接口、配对密钥存储。
- **仓库**（裁决 22）：`remote-protocol/`（Core 与 relay 共用的 crate）、`relay/`、`ios/`；CI 用 cacophony 测试向量和 Rust↔Swift 互通用例钉住加密层，
  用漂移门禁钉住应用层的数据结构。

## 1. 范围与非目标

P0 范围：票 05（通知扇出 + Core 远程模块）、票 06（relay + APNs）、票 07 用到的应用层接口定义；票 03（`client` 列）建议并入（第 12 节裁决点 5）。

P0 非目标：

- 多手机、吊销单台设备、Face ID 解锁、桌面确认配对（PRD 待定「P1 安全」）。P0 技术上允许同一配对密钥的多台设备同时在线，但不做设备管理。
- 离线排队发送（移动端产品定义：P1）。
- 手机改设置（裁决 8）、外置 GA 会话（裁决 18）。
- 任何形式的桌面直连或 Core 监听网络（Rule 2）。

## 2. 拓扑

```
iOS App ──WSS(TLS)──▶ Caddy ──▶ relay（127.0.0.1，systemd）◀── Caddy ◀──WSS(TLS)── Core 远程模块
   │                         │  频道表（内存）                                │
   └──── Noise 端到端会话（relay 看不懂）──────────────────────────────────────┘
                             │
                             └──HTTP/2──▶ APNs ──▶ 手机通知（NSE 解密）
```

- **Core 远程模块**：已配对时才连（第 7 节）。出站 `wss://<relay 域名>/v1/connect`，角色 `host`。应用层心跳不超过 25 秒，断线指数退避加抖动。
- **relay 地址从哪来**（2026-10-10 补）：用户从头到尾不接触它。
  - 桌面：发布构建在编译期从 CI 变量注入，照更新地址的先例（`core/src/app_update.rs:321` 的 `option_env!("GALLEY_UPDATER_ENDPOINT")`，
    `.github/workflows/release.yml:124`），所以砚石实例的域名不进公开源码（裁决 23）。另留运行时环境变量 `GALLEY_REMOTE_RELAY_URL` 覆盖，
    开发时连本机 relay 要用（第 10 节），也给自建 relay 的开源用户留了口；不做界面。
  - 手机：只从二维码的 `relay=` 拿（第 3.1 节），App 里不写死。
  - 以后换域名：老域名的 DNS 指到新机器即可，用户无感；真要改名，就是桌面发版加手机重扫一次码。
- **手机**：只在前台连，角色 `client`。进后台就视为随时会断：iOS 进后台约 5 秒后挂起，挂起后 socket 可能被回收，官方建议改用推送（外部 §5）。
  WebSocket 按 Apple 的建议用 Network framework 写（外部 §5，TN3151）。
- **Caddy**：`reverse_proxy` 自动支持 WebSocket。但 reload 默认会关闭已建立的 WebSocket（v2.6.0 起），所以 relay 站点要配 `stream_close_delay 5m`
  （v2.7.0 起有）。Caddy 要 ≥ 2.11.7，因为 2.11.6 引入的默认一分钟空闲超时是否作用于 WebSocket 尚未核实，靠 25 秒心跳兜底（外部 §6）。
  frankfurt 上层台的维护页开关会 reload Caddy（`inkstone-ops/docs/machines/frankfurt.md` 第五节），客户端必须能无感重连。

## 3. 密钥与身份

### 3.1 P0：一把配对主密钥

- 桌面「设置 → 手机」生成 32 字节随机**配对主密钥** MK，存进 Core 现有的凭据存储，键 `remote:pairing:mk`（`core/src/credential_store.rs:28-58`，
  AES-256-GCM，与 IM 渠道密钥同一机制）。它不在 macOS 钥匙串里：凭据存储的密文和主密钥都在同一个 SQLite 里（`credential_store.rs:1-7`），
  P1 再迁到钥匙串。
- 二维码内容：`galley-pair:1?relay=<relay URL>&mk=<base64url(MK)>&name=<桌面显示名>`。只在屏幕上展示，不落文件、不进日志。
- 派生（HKDF-SHA256，salt 为 `galley-remote-v1`，每个用途一个 info 标签）。Noise 规范要求 PSK 只用在 Noise 里（外部 §1，规范 §14），
  所以各用途分开派生：

| 派生值 | info | 用途 | 谁看得到 |
|---|---|---|---|
| `channel_secret`（32 字节） | `channel` | 连 relay 时出示；relay 用 `SHA-256(channel_secret)` 作频道键 | relay 看得到，但它只是随机串，推不出其他密钥 |
| `noise_psk`（32 字节） | `noise-psk` | Noise 握手的 psk | 只有两端 |
| `push_key`（32 字节） | `push` | 推送内容加密（第 4.3 节） | 只有两端和 NSE |

- 手机把 MK 存进钥匙串，access group 与 NSE 共享，可访问性设为 `AfterFirstUnlock`。否则锁屏或重启后 NSE 读不到密钥，只能显示占位文案（外部 §4、建议 6）。
- **「解除配对」就是轮换 MK**：桌面删掉旧 MK、断开连接，所有手机要重新扫码。P0 只有 JC 一台手机，代价可接受。
- **安全底线**：持有 MK 就等于能在这台电脑上远程执行任意操作（PRD 风险第一条；审批已在 10-05 移除）。P0 的缓解只有两条：二维码只在桌面现场展示，
  以及随时可解除配对。

### 3.2 P1 升级路径（P0 不实现，但不能堵死）

- **配对**：`XXpsk3`，二维码给一次性 32 字节配对码作 psk，担保双方首次交换的长期公钥；桌面维护手机公钥白名单，手机记下桌面公钥。
- **常规会话**：`KK`，或加每设备 psk 的 `KKpsk2`；`IKpsk2` 是 WireGuard 用过的备选（外部 §1）。
- **吊销**：从白名单删掉该设备公钥。
- **推送**：每台设备自己的推送密钥对，桌面用 HPKE（iOS 17 起有）或 Noise 单向模式加密，桌面被攻破也解不开旧推送（外部建议 5）。
- **共存**：协议版本在 prologue 里，P0 和 P1 的握手不会被互相降级；迁移时手机重扫一次码即可。

## 4. relay

### 4.1 它看到什么、能做什么（对照 Rule 2）

Rule 2 原文：「The relay sees ciphertext and routing metadata, stores no user data, and cannot issue commands.」（`AGENTS.md:107-126`）

| 项 | 设计 | 是否符合 |
|---|---|---|
| 内容 | 只见 Noise 密文；推送载荷也是密文 | 符合「只见密文」 |
| 路由元数据 | 频道键（随机串的哈希）、角色、连接起止时间、帧大小与时序、推送请求（设备 token、不透明的 collapse id） | 属于 routing metadata；帧大小会泄露「有人在看 / 在跑」，用填充减少（第 5 节） |
| IP | TCP 层不可避免；relay 与 Caddy 都不记访问日志（Caddy 默认就不记，外部 §6） | 不落盘 |
| 存储 | 只有内存里的频道表和计数器；设备 token 不在 relay 上存 | 符合「不存用户数据」 |
| 发命令 | 没有任何密钥，伪造帧过不了 AEAD 校验；推送只能转发桌面给的密文 | 符合「不能发命令」 |
| 只和已配对设备通话 | 握手要 `noise_psk`，只有扫过码的设备有 | 符合 |

### 4.2 接口

- **建连**：`GET /v1/connect` 升级 WebSocket，鉴权放请求头，不放 URL query，以免日后开访问日志被记下（外部建议 8）：
  - `X-Galley-Channel: <base64url(channel_secret)>`
  - `X-Galley-Role: host | client`
  - `X-Galley-Relay: 1`（relay 外层协议版本）
- **外层帧**（WebSocket 二进制消息；`remote-protocol` crate 的 `frame` 模块定义，Core、relay、iOS 三方共用）。首字节为类型，整数一律大端。
  每种帧只有一种布局，解码是严格的：截断、多余字节、越界取值、未知类型都报错，错误带固定标签（`empty`、`unknown_type`、`truncated`、
  `trailing_bytes`、`invalid_field`），供 relay 计数。字节表（05a 定稿，2026-10-10）：

| 类型 | 字节 | 方向 | 类型字节之后的布局 |
|---|---|---|---|
| `DATA` | `0x01` | 双向 | `peer u32` ‖ 一条 Noise 消息（1～65535 字节，外部 §1） |
| `PEER` | `0x02` | relay → 端 | `peer u32` ‖ `role u8`（`0x01` host、`0x02` client） ‖ `online u8`（`0x00` 下线、`0x01` 上线） |
| `PUSH` | `0x03` | host → relay | `request_id u32` ‖ `env u8`（`0x00` 生产、`0x01` 沙盒） ‖ `priority u8`（APNs 原值 10、5、1） ‖ `token_len u16` ‖ 设备 token（原始字节，1～1024） ‖ `collapse_len u8` ‖ collapse id（可打印 ASCII，0～64 字节，0 表示不带） ‖ 推送密文（余下全部，28～2994 字节） |
| `PUSH_RESULT` | `0x04` | relay → host | `request_id u32`（回显） ‖ `status u8`（`0x00` 成功、`0x01` token 失效即 APNs 410、`0x02` 其他失败） ‖ `apns_status u16`（APNs 的 HTTP 状态码，没收到回应为 0） ‖ `reason_len u8` ‖ reason（可打印 ASCII，APNs 的 `reason` 或 relay 自己的短码，可为空） |
| `PING` | `0x05` | 端 → relay | `nonce u64` |
| `PONG` | `0x06` | relay → 端 | `nonce u64`（原样回显） |

- **帧的语义**：
  - `peer`：relay 给频道里每条 client 连接分配非零编号，频道存续期间不复用；`0` 固定指 host。host 发出的 `DATA` 写目标 client 的编号；
    relay 把 client 发来的 `DATA` 标上该 client 的编号再交给 host；client 与 relay 之间的 `DATA` 一律写 `0`。
  - `PEER`：对端上线 / 下线。手机据此显示「电脑已离线」；Core 据此决定要不要往外推事件。host 连上时，relay 给它逐个补发已在线 client 的上线帧。
    client 连上时，relay 先发一条 host 当前在不在线的 `PEER`，手机不必猜；新 host 挤掉旧 host 时，各 client 先收到 host 下线、再收到上线，
    据此重新握手（06a 补，2026-10-10）。`peer = 0` 当且仅当 `role` 是 host，否则解码报错。
  - `PUSH` / `PUSH_RESULT`：`request_id` 由 host 选，relay 在结果里回显；成功必须配 200，失效必须配 410（桌面据此删掉 token）。
  - `PING` / `PONG`：端与 relay 之间逐跳的心跳，25 秒一次；relay 自己回 `PONG`，不转发。
  - 上限：最大的帧是满载的 `DATA`，65540 字节，也就是 relay 的 WebSocket 单条消息上限。推送密文上限 2994 字节，是 APNs 载荷不超过 4096 字节的最大值；
    实际的推送密文固定 2076 字节（第 4.3 节）。
  - 字节级样例和非法样例：`remote-protocol/tests/golden/frames.json`。

- **规则**：
  - 一个频道一个 host，新 host 连上就挤掉旧的（桌面重启的情形）；
  - client 上限 4 个；
  - 单连接限速，持续 512KB/s、突发 2MB；
  - 90 秒没心跳就断。

### 4.3 推送

- **APNs 通道**：token 认证。`.p8` 密钥签 ES256 的 JWT，每 20～60 分钟换一次；HTTP/2 长连接复用；生产端点 `api.push.apple.com`，开发构建用沙盒（外部 §4）。
- **APNs 客户端选型**：
  - 不用停更的 `a2`；
  - 用 `reqwest`（Core 已在用 0.12，`core/Cargo.toml:115`）加 `jsonwebtoken` 自己写，或者用 Threema 在维护的 `apns-h2`（外部 §4）。
  - 推荐自己写：只发一种推送，代码量小，依赖与 Core 一致。
  - 06b 落定：自己写，但不用 `reqwest` 和 `jsonwebtoken`。JWT 用 `ring`（Core 已在用 0.17）签，几十行；HTTP/2 用 hyper-util 的连接池客户端加 hyper-rustls，
    TLS 仍是 Core 已有的 rustls 0.23 加 ring、Mozilla 根证书（webpki-roots），不引入第二套 TLS。新增的 crate 只有 `h2`。
    不开 `reqwest` 的 `http2` feature 是因为 feature 在 workspace 里合并：开了它，workspace 构建里 Core 自己的 reqwest 请求也会协商 HTTP/2，
    测试构建与发版构建的行为就分叉了。
- **载荷**（≤ 4096 字节，外部 §4）：

  ```json
  { "aps": { "alert": { "title": "Galley", "body": "有新消息" }, "mutable-content": 1, "sound": "default" },
    "g": "<base64(nonce ‖ ChaChaPoly(push_key, 明文))>" }
  ```

  - 明文是 `{seq, sessionId, kind, title, body}` 的 JSON（`sessionId` 可为 `null`），按第 5 节的格式（`u16` 长度 ‖ JSON ‖ 补零）填充到固定的
    2048 字节，所有推送一样长，relay 从长度上看不出内容；
  - 密文是 `nonce ‖ ChaCha20-Poly1305(push_key, nonce, plaintext, aad = "galley-push/1")`，nonce 是 12 字节随机数，整条固定 2076 字节。
    AAD 绑定推送格式的版本：以后换格式就换 AAD，旧的 NSE 解不开（显示占位文案），不会解错。`g` 是密文的标准 base64（带填充），整个 APNs 载荷 2871 字节；
  - `title`、`body` 按 JSON 转义后的字节数截断（分别 256、1536 字节），在字符边界截，截过的末尾加「…」；
    `sessionId` 限可打印 ASCII（不含 `"` 和 `\`）、不超过 128 字节，`kind` 限 `[a-z0-9_]`、不超过 32 字节。按这套规则最坏情况也装得进 2048 字节，有测试钉住；
  - `kind` 先定四个值，对应裁决 17 的四类：`reply_done`、`ask_user`、`goal`、`schedule_failed`。这是开放集合，NSE 遇到不认识的照常显示；
  - `seq` 单调递增，NSE 在 App Group 里记已收到的最大 `seq`，拒绝 relay 重放的旧推送。建议 Core 取 `max(上一个 + 1, 当前毫秒时间戳)`，
    这样计数器丢了也不会退回到手机见过的值以下；
  - `collapse-id` 用不透明值。
  - 字节级样例（固定 nonce）：`remote-protocol/tests/golden/push.json`。
- **兜底**：NSE 30 秒内解不开，或者超时，系统显示外层的占位文案（外部 §4）。不申请静默丢弃推送的 entitlement。
- **设备 token**：手机经端到端通道调 `device.registerPush` 交给桌面，桌面存在 prefs，以后 P1 改为按设备存。收到 410 就删掉。relay 不存 token。
- **relay 侧发送**（06b 落定，2026-10-10；用法见 `relay/README.md`「APNs」）：
  - JWT：header `{"alg":"ES256","kid":<key id>}`，claims `{"iss":<team id>,"iat":<当前秒>}`，ECDSA P-256 SHA-256 签名取 64 字节的 `r ‖ s`，
    base64url 不带填充。所有推送共用一个缓存的 token，满 50 分钟才换，落在 Apple 要求的 20～60 分钟窗口里，留 10 分钟给时钟偏差。
    APNs 回 403 `ExpiredProviderToken` 或 `InvalidProviderToken` 时立即换一个、这条推送重试一次；这种强制更换 20 分钟内最多一次，
    因为新 token 治不了 key id 填错、密钥吊销或时钟偏差，不能每条推送都签一个（刷得太勤 Apple 回 429 `TooManyProviderTokenUpdates`）。
  - 连接：只走 HTTP/2（ALPN 只报 `h2`）；生产与沙盒按 `PUSH` 帧的 `env` 选端点。全进程一个客户端，每个 APNs 主机一条多路复用连接；
    空闲时每 5 分钟发一次 HTTP/2 `PING`，20 秒没回就换连接，免得推送撞上已经悄悄断掉的连接；一小时没有推送就关，下次推送再建
    （Apple 不建议的是频繁断开重连，推送稀少时隔段时间重建没有问题）。
  - 请求头：`authorization: bearer <JWT>`、`apns-topic`（bundle id）、`apns-push-type: alert`、`apns-priority`（取帧里的值）、
    `apns-expiration`（24 小时后）、帧里有 collapse id 时带 `apns-collapse-id`。过期时间取 24 小时：手机关机一夜或长途飞行都盖得住；
    APNs 对离线设备每个 App 只留最新一条，过了一天，手机重连后的重新同步比一条旧通知更说明情况。
  - 载荷就是 `push::apns_payload` 的输出，发前再查一次不超过 4096 字节（帧已限制密文长度，正常走不到）。
  - 回应：200 为成功；410 为 token 失效（Core 删 token）；其他状态码为「其他失败」，reason 取 APNs 返回 JSON 的 `reason`，
    只留可打印 ASCII、截到 255 字节。10 秒没有回应回 `apns_timeout`，连不上回 `apns_unreachable`，`apns_status` 都是 0。
  - 配置：`GALLEY_RELAY_APNS_KEY_PATH`、`_KEY_ID`、`_TEAM_ID`、`_TOPIC` 四个（也有同名命令行参数）全有才发推送，全无就回 `push_unavailable`，
    只配一部分则拒绝启动并列出缺哪几个。密钥在启动时读取并校验，读不了或不是 PKCS#8 的 P-256 私钥也拒绝启动。
    密钥是 Apple 开发者账号里下载的 `.p8`，它在服务器上的位置记在 inkstone-ops，不写进本仓。
  - 计数器：`pushes` 下加 `jwtRefreshes`（签过的 token 数，含第一个）。日志不记任何一条推送的 token、JWT、载荷或 APNs 的回应。
  - 对照 Rule 2：relay 现在持有一把密钥，即 APNs 的签名密钥。凭它能让 APNs 给 App 发通知，但发不出手机解得开的内容，
    手机只会显示占位文案；Core 与手机之间的任何东西它仍然解不开、伪造不了。
  - 测试端点：假 APNs 的地址和明文 HTTP/2（h2c）只有 `test-hooks` feature 才有，relay 自己的测试经自身 dev-dependency 打开；发版的二进制只连 Apple 的 HTTPS。
  - 未核实：没有 Apple 账号，没连过真 APNs，全部对着本地假服务器测。Apple 发的 `.p8` 在私钥结构里带曲线参数，这一点按公开样例的前缀构造了测试用密钥，
    没拿真密钥试过；APNs 证书链的根（USERTrust RSA）在 webpki-roots 1.0.7 里。
- **哪些事件推送**：裁决 17 的四类「需要关注」由 Core 判断（票 08）。本票只负责把推送发得出去、解得开。

### 4.4 实现、部署与容量

- **实现**（06a 落定，2026-10-10；用法见 `relay/README.md`）：Rust 二进制 `relay/`（包名 `galley-relay`），tokio；hyper 1 收 HTTP 与升级，
  tokio-tungstenite 0.30.0（与 Core 同一版本）跑 WebSocket；只用 `remote-protocol` 的 `frame` 和 `keys`（算频道键）。
  - 建连：路径、方法、WebSocket 升级头和三个 `X-Galley-*` 头逐项校验，不合格就在升级前回纯 HTTP 错误（404、405、400，WebSocket 版本不对回 426），
    URL 带 query 也拒；频道已有 4 个 client 回 429。占位在回 101 之前完成，两个 client 抢最后一个位置不会都进来。
  - 限速是背压，不是断开：按每条连接发给 relay 的字节记令牌桶（持续 512KB/s、突发 2MB，按 1024 进位），超了就放慢读这条连接，
    由 TCP 把压力传回发送方。25MB 的图片上传是正当流量，断开只会逼它重传。
  - 慢接收方：每条连接的待发队列到 1MB 时，往它转发的一方先等；队列 10 秒没有任何进展，就按「读得太慢」断开接收方（关闭码 4003），发送方照常。
    代价：同一 host 下一台手机卡住时，host 发往其他手机的帧最多停 10 秒。
  - 心跳：90 秒内收不到任何消息（帧和 WebSocket ping 都算）就断（4002）。
  - 违规即断：解码失败按 05a 的错误标签计数；方向不对（端发 `PEER`、`PONG`、`PUSH_RESULT`，client 发 `PUSH`）、client 的 `DATA` 写了非 0 的 peer，
    都计数并以 1008 断开；文本消息 1003；超过 65540 字节 1009。发给不在线对端的 `DATA` 丢弃并计数，不断开（`PEER` 通知已在路上）。
  - 关闭码：1001 relay 关停、1002 WebSocket 协议错、1003 文本消息、1008 帧违规、1009 超长、4001 被新 host 挤掉、4002 心跳超时、4003 读得太慢。
  - 推送：`ApnsSender` trait（`async fn send(&self, push: &PushRequest) -> ApnsResponse`，06b 实现），每条 `PUSH` 单起一个任务，不挡 host 的读；
    每个 host 同时最多 32 条在等 APNs，再多就立即回 `push_busy`。06b 之前的默认实现一律回「其他失败」、`apns_status` 为 0、reason 为 `push_unavailable`。
  - 配置：命令行参数优先，其次环境变量。`--listen` / `GALLEY_RELAY_LISTEN`（默认 `127.0.0.1:8787`），`--metrics-listen` / `GALLEY_RELAY_METRICS_LISTEN`
    （默认 `127.0.0.1:8788`，必须是回环地址）；APNs 的密钥路径、key id、team id、bundle id 留了 `GALLEY_RELAY_APNS_*` 四个变量给 06b。
    「环境」不做成 relay 配置，因为每条 `PUSH` 自带生产或沙盒；「文件」就是 systemd 的 `EnvironmentFile`（06c）。
  - 计数器：独立端口的 `GET /metrics` 回 JSON，键固定。内容是频道数、按角色的在线与累计连接数、被挤掉的 host 数、进出字节与帧数、
    推送（请求、成功、410、失败、JWT 换签次数，06b）、按标签的错误、升级前的拒绝、因对端不在而丢的帧；不含频道键、peer 编号、IP、token。
    计数从进程启动算起，「每日」由部署侧两次读数相减（06c）。
  - 日志：不记访问日志；stderr 只写启动、关停和服务器错误（如 accept 失败），不带任何标识。收到 SIGTERM 或 Ctrl-C 就停止接新连接，
    以 1001 关闭全部连接，最多等 5 秒。
- **部署**（归 inkstone-ops，裁决 23）：
  - 用 systemd 跑二进制，不进 docker：frankfurt 上 docker 会被无人值守升级重启（frankfurt 档案第三节）；
  - Caddy 站点文件配 `stream_close_delay`、关访问日志；
  - DNS 子域；APNs 密钥只写「在哪取」。
  - galley 的 CI 出 relay 构建产物，tag 用 `relay-v*`。
- **容量**：frankfurt 端口 200Mbps、流量不限（档案第一节，2026-10-10）。按 relay 用一半带宽、每人在看时 2～10KB/s 估：同时约 1200～6000 人在看。
  先撞到的是大件传输（图片、历史）的延迟，所以第 6 节做了这几件事：
  - 历史分页；
  - 图片在手机端先压缩；
  - 流式事件 100ms 合批；
  - 按连接限速。

## 5. 端到端会话（Noise）

- **模式**：`Noise_NNpsk0_25519_ChaChaPoly_SHA256`。iOS 的 CryptoKit 没有 BLAKE2，所以选 SHA256 套件（外部 §3）。
- **角色**：手机是发起方，Core 是响应方。
- **prologue**：`galley-remote/1` ‖ relay 外层版本 ‖ 双方角色，把版本绑进握手，防降级。05a 定稿的 19 个字节：

  | 偏移 | 长度 | 内容 |
  |---|---|---|
  | 0 | 15 | ASCII `galley-remote/1`（P1 的握手改用 `galley-remote/2`） |
  | 15 | 1 | `0x00` 分隔 |
  | 16 | 1 | relay 外层版本，即 `X-Galley-Relay`，现为 `0x01` |
  | 17 | 1 | 发起方角色，`0x02` client（手机） |
  | 18 | 1 | 响应方角色，`0x01` host（Core） |

  合起来是 `67616c6c65792d72656d6f74652f3100010201`；角色字节与外层帧 `PEER` 的 `role` 同一套编码。
- **握手两步**：
  1. 手机 → Core：`psk, e`，载荷为空，所以整条固定 48 字节（32 字节 `e` 加空载荷的 16 字节标签），Core 拒收其他长度。
     这条消息只靠 psk 保护，可被重放、没有前向保密，所以什么都不放（外部建议 1）。
     relay 重放它也没用：Core 会回一个新的 `e`，重放者没有手机的临时私钥，算不出会话密钥。
  2. Core → 手机：`e, ee`，载荷是 Core 的 hello（见第 6 节），按下文的格式填充；hello 本身 1～4096 字节。
- **传输**：
  - 每条手机连接一个会话，重连就重新握手，开销很小；
  - 会话最长 24 小时，到点主动重连换密钥；
  - 每条 Noise 消息 ≤ 65535 字节，应用层超过就分片（第 6 节 `chunk`）；
  - 会话结束显式发结束标记，防截断（外部建议 10），格式见下一条。
- **传输记录与结束标记**（05a 定稿）：每条传输消息的明文是一条记录，即「填充（类型 `u8` ‖ 内容）」：
  - `0x01` APP：内容是一条应用层消息或一个分片，1～65516 字节；
  - `0x02` CLOSE：内容是 1 字节原因：`0x00` 正常结束、`0x01` 会话满 24 小时、`0x02` 协议大版本不一致、`0x03` 已解除配对（桌面换了配对主密钥），
    其他值按正常结束处理；
  - CLOSE 就是结束标记：要结束的一方先发 CLOSE 再断开，此后不能再有记录。没收到 CLOSE 连接就断了（relay 断线、`PEER` 下线），算截断：
    丢掉分片重组之类的半截状态，下次连上重新同步（第 6.5 节）；
  - 任何一条解不开（标签不对、填充不规范、类型不认识、重放或乱序），这个会话就作废，不再继续用。
  - 样例：`remote-protocol/tests/golden/noise-nnpsk0.json`（固定临时钥的完整会话，含握手、两条 APP 和一条 CLOSE）。
- **不压缩，只填充**：
  - agent 读的网页由外部攻击者控制，又和对话内容在同一压缩上下文里，relay 看得到密文长度，满足 BREACH / VORACLE 类攻击的前提。
    RFC 9113 §10.6 的结论是不压缩（外部 §7）。
  - WebSocket 的 permessage-deflate 关掉。
  - 明文填充：小于 256 字节的补到 256，更大的按 Padmé（额外开销 ≤ 12%，外部 §7）。05a 定稿的格式：`u16` 大端长度 ‖ 内容 ‖ 补零，
    总长为 `max(256, padme(2 + len))`（`len` 是内容长度），上限 65519（65535 减 16 字节标签）。解填充是严格的：总长必须正好是该长度对应的规范值，补的必须全是零；
    所以改填充规则就要换 prologue 的版本。推送用同一格式，但总长固定 2048（第 4.3 节）。
- **库**：
  - Rust 用 `snow` 0.10.0。它支持 psk；没有正式审计；0.9.5 修过一个 nonce DoS（外部 §2）。
  - Swift 三条路：用 CryptoKit 原语写一个薄的 Noise（iOS 13 起原语齐全，规范 §5 有伪代码）；vendor `swift-libp2p/swift-noise` 并锁定提交（4 star，1 个贡献者）；
    或者把 Rust 这一份编译进 App，Swift 经绑定调用。见第 12 节裁决点 2。
- **测试**：Rust 和 Swift 两侧都跑 cacophony 向量（944 条，覆盖 NNpsk0、XXpsk3、KK 等的 ChaChaPoly_SHA256 组合）。
  另加一条固定临时钥的 Rust↔Swift 互通用例；snow 有 `fixed_ephemeral_key_for_testing_only`（外部 §3）。
  05a 只 vendor 了用得到的三条：`NNpsk0`、`XXpsk3`、`KK`（均为 `25519_ChaChaPoly_SHA256`），来源、提交与许可（Unlicense）见
  `remote-protocol/tests/vectors/README.md`。固定临时钥和固定推送 nonce 的钩子只在 crate 的 `test-hooks` feature 里，Core 和 relay 不开。

## 6. 应用层协议（端到端通道内）

### 6.1 消息形状

JSON，UTF-8；每条 Noise 传输消息装一条，大的经 `chunk` 重组后再解析。

- 请求：`{"t":"req","id":7,"m":"session.send","p":{...}}`
- 响应：`{"t":"res","id":7,"ok":true,"r":{...}}`；失败为 `{"t":"res","id":7,"ok":false,"e":{"code":"history_replay","message":"..."}}`。
  错误码沿用 Core 已有的稳定标签，例如 02c 的 `images_not_queueable`（`core/src/session_send.rs:143-151`）。
- 事件：`{"t":"evt","n":"session.updated","p":{...}}`
- 分片：`{"t":"chunk","id":7,"i":0,"last":false,"data":"<base64>"}`

**数据结构单独定义**：在 `remote-protocol` 里显式定义手机用的类型（camelCase），不直接序列化 Core 的内部类型，由 Core 负责转换。这样做的理由：

- Core 内部类型改了不会意外破坏手机；
- `PersistedMessageRow` 甚至是 snake_case（`core/src/db/rows.rs:157-179`）。

### 6.2 版本握手（补 PRD 待定「手机协议的版本握手规则」）

- Core 的 hello：`{protocol: {major: 1, minor: n}, coreVersion, desktopName}`；手机的第一条请求是 `hello`，带 `{protocol, appVersion}`。
- 同一 major 内只加不删。未知字段忽略，未知方法回 `unknown_method`，未知事件忽略。
- major 不同：两端都提示该升级哪一边（「请升级 Galley 桌面」或「请到 App Store 更新」），然后断开。

### 6.3 方法（P0）

| 方法 | Core 实现（代码事实） | 说明 |
|---|---|---|
| `hello` | — | 版本握手 |
| `sessions.list` | `GalleyApi::list_sessions`（`core/src/api.rs:76`），按 `runtimeKind = managed` 过滤（裁决 18）；附每个会话的运行状态 | 全量。P0 约 125 条，几十 KB；没有增量查询，删除是硬删除、没有墓碑（`db/session.rs:259`，`api.rs:248-252`），全量最简单 |
| `session.messages` | `persisted_message_rows`（`db/session.rs:42-70`）转换成手机的类型，加分页参数 `before` / `limit` | 原函数不分页，要加分页；打开会话先取尾部，往上翻再取 |
| `session.send` | `session_send::send_user_message`（`session_send.rs:173-214`），`origin.via = gui`、`client = ios`（裁决 9） | 图片 ≤ 4 张、单张 ≤ 10MB（`commands/session.rs:4-6`），手机先压缩，大的走 `chunk` 上传；带 `clientRequestId`，认领规则同 GUI（02c） |
| `session.stop` | `stop_session_run`（`session_send.rs:385-398`） | |
| `session.create` | `Writes::create_session`（`session_writes.rs:304-312`），会话 id 由 Core 生成 | `mint_session_id` 现在是 `pub(super)`（`socket_listener/session_cmds.rs:726-750`），要放宽可见性 |
| `session.markRead` | `Writes::clear_session_unread`（`session_writes.rs:423-427`） | 写库后会自动广播 |
| `session.subscribe` / `unsubscribe` | 远程模块记下该手机正在看的会话 | 只给订阅的会话转发 `runner-event` |
| `attachment.read` | **新增**：按附件 id 读，只允许 `conversation-attachments/` 下的文件（`app_paths.rs:37-66`），分片返回 | **不开放 `access_local_file`**：它接受任意绝对路径（`local_file.rs:80-96`） |
| `device.registerPush` | 新增：把手机的 APNs token 存进 prefs | |

### 6.4 事件（经通知扇出转给已连接的手机）

| 事件 | 来源 | 说明 |
|---|---|---|
| `session.created/updated/archived/unarchived/moved/deleted` | 02d 的 `*-external`（`session_writes.rs:52-60`），`SessionBriefEvent` 显式带 null | 只转内置会话 |
| `project.created/updated/deleted` | 同上 | 侧栏分组 |
| `message.persisted` | `user-message-persisted`（四处来源，见代码事实第 2 节） | 带 `clientRequestId` |
| `runner.event` | `runner-event`，只转订阅的会话 | `turn_progress` 按 100ms 合批；单条最大的是 `turn_end`，带完整工具调用与结果（`core/src/ipc.rs:184-219`） |
| `session.runState` | **新增**的 Core 事件（第 7 节缺口 3） | 「在跑 / 在问你 / 排队」 |
| `history.replay`、`goal.updated`、`queue.changed` | 已有 | |
| `sync.required` | 远程模块自己发（05a 新增） | 丢过给这台手机的事件后通知它重读，见第 6.5、6.6 节 |

### 6.5 重新同步

- 连上或重连时依次做：
  1. `hello`；
  2. `sessions.list`（含运行状态）；
  3. 若正在看某会话：`session.messages` 取尾部，再 `subscribe`。
- 事件漏了就以重读为准，与 `notify.rs:16-23`「GUI 漏了事件从数据库重读」同一个约定。
- 转发队列按手机分开、有上限。手机跟不上时先丢 `runner.event` 的增量，状态类事件保留；丢过就让手机重拉当前会话。

### 6.6 05a 落定的细节（2026-10-10）

`remote-protocol` 的 `app` 模块按下面实现；每个方法、每种事件的 JSON 样例在 `remote-protocol/tests/golden/app-messages.json`。

- **可选字段与枚举**：手机侧类型的可选字段一律显式写 `null`，读的时候 `null` 与缺省等价（02d 的规矩）。开放集合的枚举（会话状态、`via`、
  发送结果等）都有 `Unknown` 兜底，新增取值不会让旧版解码失败。
- **`hello`**：协议版本 major 1、minor 0。Core 的 hello 同时就是 `hello` 方法的结果；major 不一致时 Core 回 `protocol_mismatch`，再发原因为 `0x02` 的 CLOSE。
- **`sessions.list`**：结果是 `{sessions, projects, runStates}`。带上全部项目供侧栏分组；`runStates` 只列不是空闲默认值的会话，不在里面的就是空闲。
- **`session.messages`**：`before` 是上一页里的消息 id（`null` 取尾部），`limit` 缺省 50、上限 200；结果按时间正序，带 `hasMore`。
- **`session.send`**：图片用 `{mimeType, data, width, height}`，`data` 是标准 base64，不用 data URL；限额照桌面（4 张、单张 10MB、合计 25MB）。
- **透传的大块 JSON**：`runner.event` 的载荷是 `{sessionId, events: [...]}`，一条消息装 100ms 合批的多条 runner 事件，每条原样透传 Core 的 `IpcEvent` JSON；
  消息的 `toolCalls` / `toolResults`、`goal.updated` 的 `goal` 也原样透传，不在手机类型里展开。
- **`sync.required`**：载荷 `{sessionId}`。Core 丢过给这台手机的事件（第 6.5 节队列满）时发，手机据此重读；`sessionId` 为 `null` 表示全部重读。
- **分片**：
  - `chunk` 的 `id` 是发送方自己的流编号，与请求 id 无关；`i` 从 0 逐一递增，`last: true` 结束；不同的流之间、流与普通消息之间可以交错；
  - 每片原始数据 1～48000 字节，base64 之后仍装得进一条记录；重组出来必须是一条完整的、非 `chunk` 的消息；
  - 接收方同时最多收 4 条流，在途合计不超过 40MiB（够装 25MB 图片的 base64 加 JSON），超了就报错并丢掉该流。

### 6.7 05b 落定的细节（2026-10-10）

手机看得到的几条，Core 实现时定下：

- **错误码**：新增 `session_not_managed`（会话属于外置 GA，手机不显示）和 `too_many_subscriptions`（一台手机同时最多订阅 16 个会话）。
  会话不存在、`before` 指向的消息不存在都回 `not_found`；附件读取失败沿用 05c 的 `attachment_*` 标签；图片不合规回 `invalid_args`，文案与桌面相同。
- **写入的来源**：手机的发送与新建是 `origin.via = gui`、`client = ios`（裁决 9）；由此产生的会话事件里 `via` 是 `ios`。
- **`session.create`**：不带标题就用「新对话」，第一条消息会给它起名，与桌面一致；模型留空，起 runner 时用内置运行时的默认模型。
- **顺序**：Core 不强制 `hello` 在先；`session.unsubscribe` 总是成功。
- **事件过滤**：`goal.updated` 按 `goal.sessionId` 判断是否内置会话；`project.deleted` 的 `detachedSessionIds` 只列内置会话；
  `session.deleted` 只要不是已知的外置会话就转发（行已删，查不到运行时）。

## 7. Core 改动（票 05）

**结构**：新模块 `core/src/remote/`，包括：

- 连接任务：tokio-tungstenite 加 rustls，这是**新依赖**，Core 目前没有任何 tungstenite（`core/Cargo.toml`）；
- Noise 会话：snow；
- 请求分发：调用第 6.3 节列出的函数，不经 Tauri 命令层；
- 事件转发：按手机分订阅、合批、限流。

在 `start_background_services`（`core/src/app_setup.rs:396-451`）里、单实例检查之后启动；在托盘退出清理时停止（`tray.rs:118-137`）。
发送要拿到 `AppHandle` 作为 `SpawnEnv`（`session_runner/mod.rs:92-99`），远程模块在 Core 进程内，天然有。

**05b 落定（2026-10-10）**：

- **分文件**：`config`（relay 地址、桌面名、时序与上限）、`connection`（连接、重连、心跳、帧收发、按手机扇出）、
  `phone`（每台手机的 Noise 会话、分片重组、有上限的发送队列）、`methods`（第 6.3 节各方法）、`convert`（Core 类型转手机类型）、
  `events`（接收端、过滤、合批）、`push`（设备 token 与推送序号）。
- **依赖**：`tokio-tungstenite` 锁 `=0.30.0`（与 relay 同版本），开 `connect` 与 `rustls-tls-native-roots`，用的是 Core 已有的
  rustls 0.23、tokio-rustls 0.26、rustls-native-certs 0.8，没有引入 webpki-roots。`futures-util`、`whoami`、`zeroize` 原本就在 lockfile 里；
  tungstenite 0.30 新带进 13 个包（sha1 0.11 一系与 rand 0.10 一系）。
- **桌面名**：系统里的电脑名（macOS 的「电脑名称」），取不到用主机名，再取不到用 `Galley`，截到 128 字节。
- **生命周期**：没有 relay 地址就不建模块（`RemoteModule::for_app` 返回 `None`）；有地址时作为 Tauri 状态托管，启动时只在已有配对主密钥时连，
  托盘退出时先给在线手机发 `CLOSE Normal` 再断开（最多等 3 秒）。给 05d 的接口：`pair()` 确保有主密钥、确保在连、返回二维码串；
  `unpair()` 给在线手机发 `CLOSE Unpaired`、停止、删除主密钥；`status()` 返回是否已配对、relay 是否在连、在线手机数、最近一次手机握手的时间，
  有变化就发 Tauri 事件 `remote-status`。再次配对沿用同一把主密钥，已连的手机不受影响；解除配对后再配对才生成新密钥。
- **连接**：环境变量里是 relay 的基础 URL，连接地址用 `RelayUrl::connect_url()` 拼；三个请求头照第 4.2 节，不带 `Sec-WebSocket-Extensions`。
  每 25 秒一个 `PING`，60 秒收不到 `PONG` 就重连。重连指数退避：1 秒起、上限 60 秒，每次在当前步长的后一半里随机取；连接活过 30 秒才把退避清零。
  relay 的关闭码一律按「退避重连」处理；4001（新 host 挤掉了旧的）不清零退避，同一轮只记一次日志，免得两台用同一把密钥的桌面互相挤时刷屏。
- **每台手机**：按 relay 的 peer 编号建，第一条 `DATA` 当握手；`PEER` 上线或下线都丢掉这个编号原有的会话；任何一条记录解不开就丢掉这台手机；
  会话满 24 小时发 `CLOSE Expired`。发送队列里放明文，出队时才加密，所以丢事件不会让手机少收一个 nonce。
- **事件**：接收端只做过滤和拷贝：没有手机在线就什么都不拷，`runner-event` 只拷有手机订阅的会话；队列（1024 条）满了就丢，
  下一条事件时让所有手机全量重读。转换任务用 Core 自己的类型解码载荷（为此给 `SessionRunStatePayload`、`HistoryReplayPayload` 加了 `Deserialize`），
  只留内置会话（按会话 id 缓存运行时）；关于某会话的状态事件会先把该会话攒着的 `runner.event` 发出去，保持 Core 的先后顺序。
- **每台手机的队列**：事件预算 512 条或 4MiB，响应不计入、也不丢。超了先丢排着的 `runner.event`，按会话补 `sync.required`；
  状态事件本身也装不下时，丢掉所有未发出的事件，补一条 `sessionId` 为 `null` 的 `sync.required`。已经开始发的分片消息会发完。
- **数据层**：新增 `SqliteGalley::message_cursor`，把手机给的消息 id 换成分页游标；`commands::session` 拆出 `decode_image_uploads`，
  手机的图片与桌面走同一套限额和错误；`mint_session_id` 放宽到 `pub(crate)`。
- **推送**：设备存 prefs 键 `remote_push_devices`（按 token 去重，最多 8 台），序号存 `remote_push_seq`，先写后用。
  `send_push` 封一次、每台设备发一个 `PUSH`，优先级 10，不带 collapse id；没在运行回 `remote_not_running`，relay 没连上回 `relay_offline`。收到 410 就删 token。
- **测试**：`core/tests/remote_module_test.rs` 14 条，进程内假 relay（127.0.0.1）加用 05a 客户端函数写的假手机；内部逻辑另有 18 条单元测试。
  `session.send` 走 Core 真实的发送路径，runner 用测试替身（已在跑、历史已确认），所以测到落库、广播和派发的 `user_message`，不起 Python。

**要补的缺口**（代码事实）：

1. **通知扇出**：现在没有组合用的 Notifier，`TauriNotifier::new` 在 `core/src` 里有 35 处临时构造，有些在长期任务里一直捕获着
   （runner 的 emit 任务、自动标题任务、排队消费者）。推荐让 `TauriNotifier` 在发给页面之后，再转给一个进程级的「远程接收端」
   （`OnceLock`，远程模块启动时注册，没注册就什么都不做）。35 处构造一处都不用改，长期任务也自动带上。
   备选是统一工厂、替换 35 处：改动面大，收益只是不用全局变量。
2. **轮次落库后广播会话更新**：Core 写完一轮不广播 `turn_count / summary / last_activity_at`（`turn_persistence/mod.rs:157-170`），
   手机的会话列表会过时。把 02e 里「让 `turn_persistence` 广播会话更新」这一项提前做。GUI 侧 02d 已经加了「只取不落后于本页的轮次进度」的守卫，
   收到这条广播不会重复加一。
3. **运行状态事件**：`RunState` 只在内存里，也没有变化事件（`runner_manager/manager.rs:72-94,846-869`）。新增 `session-run-state`，
   在闸门、`agent_running`、`ask_pending`、队列长度变化时发出。手机靠它显示状态，不必像 GUI 那样从 runner 事件里推断。
4. **附件只读接口**：见第 6.3 节 `attachment.read`。
5. **配对密钥**：见第 3.1 节，存凭据存储；`client` 列见第 12 节裁决点 5。

**桌面界面**：设置里新开「手机」页，含配对二维码、解除配对、连接状态（在线手机数、最近一次连接）。按裁决 10，同页检查「接通电源时保持唤醒」
和「关闭窗口时保持后台运行」（`tray.rs:47-58`）。

## 8. relay 实现（票 06）

- `relay/`：频道表 `HashMap<频道键, {host, clients}>`，按外层帧转发，代发 APNs，计数器。不依赖 Core。06a 已实现 APNs 发送以外的全部（第 4.4 节）。
- 测试：进程内起 relay，加两个假端点，覆盖转发、挤掉旧 host、限速、心跳超时、推送 410 回报；APNs 用假服务器。
  - 06a 落定：relay 绑 `127.0.0.1:0`，假 host 和假手机都是普通 WebSocket 客户端，收发 05a 的帧。15 个集成用例覆盖双向转发与 peer 改写、
    `PEER` 通知与给晚到 host 的补发、挤掉旧 host、第 5 个 client 被拒、升级前拒绝坏请求、非法帧计数并断开、超长消息、心跳超时、限速只放慢不断开、
    慢接收方被断开、host 推送回 `push_unavailable`、假 `ApnsSender` 的 410 回报、client 推送被拒、计数器不含标识、关停。
  - 定时器靠缩小 `Limits` 提速，不用 tokio 的暂停时钟：时钟暂停时，运行时一等真实 socket 就会把时间往前拨。
  - 走 HTTP/2 的 410 回报（假 APNs 服务器）归 06b。
  - 06b 落定：`relay/tests/apns.rs` 起两个进程内的假 APNs（生产、沙盒各一，明文 HTTP/2，记录每个请求、按脚本回应），用测试里现生成的 P-256 密钥。
    7 个用例覆盖 JWT 的 header、claims 和签名（用公钥验）、每个请求头、载荷逐字节、环境选端点、token 与连接复用、200 / 410 / 400 / 403 / 429 / 500 的映射、
    403 换 token 后只重试一次、超时、连不上、经 relay 帧路径发 `PUSH` 收回对应的 `PUSH_RESULT`。另有单元测试覆盖密钥解析（含 Apple 的密钥结构、
    P-384 与 Ed25519 被拒）、token 的复用与更换窗口、配置的全有 / 全无 / 半套。
  - 端到端：`core/tests/remote_e2e_test.rs` 把真 relay 当库起在 `127.0.0.1:0`，APNs 的位置放一个记录用的 `ApnsSender`，配对后的 Core 远程模块连上去，
    假手机经 relay 握手、`hello`、`sessions.list`、`session.send`、订阅后收 `runner.event`；`send_push` 到达记录器，用手机的 `push_key` 从载荷的 `g` 解开、核对内容；
    再回一次 410，Core 删掉 token。05b 的假手机、假 runner 等辅助挪进 `core/tests/common/remote.rs`，两边共用，05b 测试的断言不变。

## 9. iOS 侧的协议要点（票 07 的一部分）

- Network framework 写 WebSocket；Noise 的实现方式见第 12 节裁决点 2。
- 钥匙串 access group 与 NSE 共享，可访问性 `AfterFirstUnlock`。
- 进后台就主动断开；回前台重连并重新同步（第 6.5 节）。
- NSE 预算按 30 秒、24MB 估。24MB 只有 Apple DTS 论坛的口径，未核实（外部 §4）。
- **协议包（07a，2026-10-10）**：`ios/GalleyRemote/`，SwiftPM，纯 Swift 加 CryptoKit，没有第三方依赖，平台 iOS 26（PRD 裁决 12），
  另声明 macOS 14 只为在 Mac 上跑 `swift test`。没有界面和网络。结构与用法见包内 README。
  - Noise 按裁决点 2 A 在 CryptoKit 原语上自写，照规范第 34 版：`CipherState` / `SymmetricState` / `HandshakeState` 对握手模式泛型，
    支持 `NNpsk0`，以及 P1 要用的 `XXpsk3`、`KK`（三者都有 vendored 向量，通用部分是同一套），共约 430 行，不含会话层。
    X25519 用 `Curve25519.KeyAgreement`；ChaChaPoly 的 nonce 是 4 个零字节加 64 位小端计数；Noise 自己的 HKDF 照规范第 4.3 节用 `HMAC<SHA256>` 拼，
    不是 RFC 5869。CryptoKit 的 `HKDF<SHA256>`（RFC 5869）只用于第 3.1 节的配对密钥派生，与 Rust 的 `hkdf` crate 一致。
  - 手机侧会话接口对齐 Rust 的 client 一侧：`NoiseSession.clientStart` 产出 48 字节的握手请求，`ClientHandshake.finish` 读 Core 的 hello 并解填充，
    `Transport` 封、拆 `APP` 和 `CLOSE` 记录，任何一条拆失败，之后的拆都报会话已作废。固定临时钥的入口和 host 一侧只给测试用（`internal`）。
  - 其余与 Rust 一一对应：配对密钥派生与二维码严格解析（含 relay 地址里 IPv4 / IPv6 字面量的判定，照搬 Rust 标准库解析器的接受集合）、
    六种外层帧、填充、推送 `g` 的解密、应用层 `Codable` 类型、分片与重组。超出 Rust 单测的边界用例，预期结果都在 Rust crate 上手工跑过核对。
  - 与 Rust 的差异：
    - JSON 用 Foundation 的 `JSONDecoder` 解码，整数写成 `1.0`、`1e2` 也按整数读，对象里键重复时取第一个而不报错，比 serde_json 宽松；
      两端都不会产出这种输入。字段有无、`null`、未知字段和枚举值的处理与 Rust 相同。
    - `ClientHandshake`、`Transport` 是类：Rust 的移动语义变成「第二次 `finish` 报错」和「会话不能被复制」。
    - 推送明文的 JSON 手写序列化，字段顺序和转义照 serde_json，保证填充后的明文与 Rust 逐字节相同。
  - 测试框架：本机只有 Command Line Tools，Swift Testing 能用，但 SwiftPM 6.2 不给测试目标加 `Testing.framework` 的搜索路径，
    框架附带的 `_Testing_Foundation`（cross-import overlay）也缺模块文件，直接 `swift test` 报 `no such module 'Testing'`。
    包里的 `swift-test.sh` 在只有 Command Line Tools 时补上路径并关掉 cross-import overlay，其余情况就是 `swift test`；CI 装了 Xcode，直接 `swift test`。
  - 实现中查出并修掉一处 Swift 特有的坑：CryptoKit 的 `SealedBox.ciphertext` 是切片、下标从 12 起，拼出的 `Data` 若不复制，调用方按 0 起的下标访问会崩。
    线上字节不受影响，Rust 的 fixture 也没有改动。

## 10. 测试与门禁

| 层 | 钉法 |
|---|---|
| Noise | 两侧都跑 cacophony 向量；Rust↔Swift 固定临时钥互通用例（07a 已落：Swift 侧两端都跑，`noise-nnpsk0.json` 的两条握手消息、两条 APP 和 CLOSE 逐字节一致） |
| 外层帧 | `remote-protocol` 的 golden 帧字节，Rust 与 Swift 两侧解码同一份；Swift 还逐字节重新编码，非法样例的错误标签逐条对上 |
| 密钥、填充、推送 | golden 的派生值、二维码串、填充长度、固定 nonce 的推送密文，Swift 逐字节复现；二维码的非法样例与 Rust 错误的 `Debug` 文本逐条对上 |
| 应用层数据结构 | Rust 类型生成 JSON 样例（golden fixtures），Swift `Codable` 逐条解码再编码回去，按 JSON 值比较。这就是漂移门禁，不另写 `check-remote-protocol-drift` 脚本（见表后） |
| relay | 进程内集成测试 |
| 端到端 | dev 环境：本机起 relay、Core 连本机 relay、iOS 模拟器连本机；真机再连 frankfurt |

漂移门禁（07a 定，2026-10-10）：

- Swift 测试原地读取 Rust crate 的 golden 文件和向量文件，不复制，所以 Rust 侧重新生成的 fixture 直接进 Swift 测试。
- 对到字段级，下列情况 Swift 测试都会红：
  - golden 目录多一个文件，或某个文件多一个顶层段；
  - 样例多一个字段：Swift 解码时丢掉，编码回去就对不上；
  - 枚举多一个取值：Swift 解成 `unknown`，编码回去也对不上；
  - 多一个方法或事件：方法、事件清单对不上，或样例找不到 Swift 类型。
- Rust 侧的 golden 测试保证「改了结构不改 golden 就红」，两段接起来就是 Rust 类型到 Swift 类型的完整链条。
- `check-ipc-protocol-drift.mjs` 之所以要单独解析 Python、Rust、TS 三份源码，是因为没有哪一侧的测试会读另一侧的输出；这里 Swift 测试本身就读 Rust 的输出，
  再写一个脚本只会重复同一项检查。
- 漏得过去的只有样例里看不出的变化：没被样例用到的新枚举值（开放集合，旧版解成 `unknown`）、新的错误码常量（手机按通用失败处理），这两种不影响解码；
  数值字段变宽而样例值没变（比如 `u32` 改 `u64`），要等真出现超出旧范围的值才会暴露，所以改数值类型时要同步改 Swift。

CI：`.github/workflows/ios-protocol.yml`（07a），macOS runner（`macos-26`，Xcode 26），按路径过滤 `ios/**`、`remote-protocol/**` 和 workflow 自身，
所以 Rust 侧改协议也会跑 Swift 测试。等 App 工程进来，再把桌面样式与文案源加进过滤。公开仓用 GitHub 托管的 macOS runner 不计费。

## 11. 未核实与风险

- 未核实（外部调研列出）：
  - NSE 的 24MB 内存上限；
  - time-sensitive 中断级别的 entitlement 键名；
  - Caddy 2.11.6 起的空闲超时是否作用于已升级的 WebSocket；
  - `swift-noise` 测试向量的来源；
  - Signal 的 NSE 是否去服务器拉内容。
- 中国区上架的 App 备案对跨境转发有无额外要求：未核实（PRD 风险已列）。
- `snow` 没有正式审计。缓解：锁版本、关注 RUSTSEC 公告、只用规范推荐的模式。
- relay 是全天候生产服务，只有 JC 一人运维。它无状态，换机器只要改一条 DNS；层台转正式生产时考虑把 relay 迁到独立小机器，与客户的生产环境隔离。

## 12. 裁决点（2026-10-10 JC 已裁 1、2、4、5，3 撤销）

1. **P0 握手先简后升，还是一步到位？** 已裁 A。
   - **A（已裁）**：P0 用 NNpsk0，一把共享主密钥；P1 升级 XXpsk3 配对加 KK 会话，迁移时重扫一次码。P0 实现最少，P0 只有你一台手机，吊销需求还不存在。
   - B：P0 直接上 XXpsk3 配对加 KK 会话加设备白名单。省掉一次迁移，但 P0 要多做公钥生成存储、白名单和两种握手。
2. **手机这头的 Noise 代码从哪来？** 已裁 A（JC 先问「什么是 iOS 侧的 Noise」，补了解释和选项 C 后裁定）。
   Noise 是端到端加密那一层的公开协议（WireGuard、WhatsApp 都用它），规定两端怎么握手协商出会话密钥、之后每条消息怎么加密。
   两端要各有一份实现、逐字节一致：电脑这头是 Rust，用现成的 `snow`；手机这头是 Swift，没有像样的现成库。
   - **A（已裁）**：用 iOS 自带的 CryptoKit 提供的原语（X25519、ChaChaPoly、SHA256、HMAC）自己拼，只实现用到的模式，估计三四百行（推理，按规范 §5 伪代码的规模）。
     两侧跑同一套 cacophony 向量，再加 Rust↔Swift 互通用例。没有第三方依赖，iOS 工程保持纯 Swift，开源后别人也好审。
   - B：vendor `swift-libp2p/swift-noise` 并锁定提交。现成，但只有 4 star、1 个贡献者，向量来源不明。
   - C（初稿漏列，补）：把 Rust 这一份编译成 iOS 库，Swift 经绑定（UniFFI）调用。只有一份实现，两端不可能不一致；先例有 Signal 的 `libsignal`、
     Element X 的 `matrix-rust-sdk`、Firefox iOS 的 `application-services`。代价是 iOS 构建永久带上 Rust 工具链和 xcframework 打包
     （JC 的 Mac 是 Intel，模拟器还要多一个 `x86_64-apple-ios` 目标），NSE 也要链进去，开源贡献者门槛变高。这些项目共享的是整套协议逻辑，
     我们只有一个握手加帧加密，摊不平这笔固定成本。
   - 推荐 A 的出口：线上协议与实现方式无关，以后手机这头的共享逻辑变多（比如 P1 的配对与吊销）再换 C，用户无感。
3. **relay 用什么域名？** 撤销，不是产品决策。JC 指出用户不接触 relay，核对后初稿「App 里会写死这个地址」是错的：
   手机从二维码拿地址（第 3.1 节），桌面在编译期注入（第 2 节「relay 地址从哪来」），以后换域名用户无感。具体子域在部署票 06c 动 DNS 时提、问过 JC 再建。
   用户唯一会读到「中转」二字的地方是隐私说明：消息经砚石的中转服务器加密转发、服务器看不到内容。
4. **通知里显示什么？** 已裁 A。
   - **A（已裁）**：显示真实内容，标题是会话标题，正文是回复摘要或「在问你：问题」。推送是端到端加密的，只有手机能解开；锁屏是否显示预览交给 iOS 系统设置。
   - B：只显示「Galley：有新消息」，内容要点开 App 才看到。更保守，但「它来找你」这个场景（移动端产品定义）会弱很多。
5. **范围合并**：票 03（`client` 列迁移）和 02e 里「轮次落库广播」一项并进 05。已裁并进。
   前者是手机用量统计（PRD「P0 要回答的问题」）的前提，后者是手机会话列表正确的前提。两者都很小，单独排期反而多一轮合入和验收。

## 13. 实现拆分（2026-10-10）

次序：05a、05c 先并行；05a 合入后 06a、07a 并行；05b 等 05a 与 05c；05d 等 05b；06b 等 06a；06c 等 06a、06b。
都在 scratchpad 的 git worktree 里做，合入主树前查 `galley status` 的 `busy:0`（合入会让 JC 开着的 dev 重启 Core）。

### 05a — `remote-protocol` crate（无依赖）

- 位置：仓根 `remote-protocol/`，加进 `core/Cargo.toml` 的 workspace members。不依赖 tokio、Tauri 和 Core，因为 relay 也要用。
- 内容：
  - 密钥：配对主密钥经 HKDF 派生三把钥匙、频道键、二维码串的生成与严格解析（第 3.1 节）；
  - 外层帧：六种帧的字节布局与编解码，布局以字节表写回第 4.2 节；
  - Noise：snow 0.10.0 封装 `NNpsk0`，含 prologue、两步握手、传输加解密、结束标记、单条上限（第 5 节）；
  - 填充：256 字节下限加 Padmé；
  - 推送：用 `push_key` 加解密推送明文，按桶长填充，保证 APNs 载荷 ≤ 4096 字节（第 4.3 节）；
  - 应用层：信封（req / res / evt / chunk）、P0 各方法的参数与结果、事件载荷、协议版本常量（第 6 节），camelCase；分片与重组。
- 测试：
  - cacophony 向量，只收用到的套件，记下来源与许可；
  - golden 文件：外层帧字节、应用层 JSON 样例、固定临时钥的握手与推送密文，供 07a 的 Swift 侧解码；改了结构不改 golden 就红。
- CI：`check.yml` 加 `cargo test -p galley-remote-protocol`（包名 `galley-remote-protocol`，库名 `galley_remote_protocol`）。
  现有步骤只跑 `-p galley-core` 和 `-p galley-cli`（`check.yml:204-217`），不会自动带上新 crate。
- 不做：网络、Core 接线。

### 05c — Core 缺口（无依赖，与 05a 并行）

第 7 节的五个缺口，加两项数据层：

1. 通知扇出：`TauriNotifier::emit` 发给页面之后，转给进程级的远程接收端。接收端不得阻塞调用方（有界队列，满了就丢）；没注册时什么都不做；35 处构造不动。
2. 轮次落库后广播：`turn_persistence` 在 `bump_session_after_turn` 之后发 02d 同款的会话更新事件（`turn_persistence/mod.rs:157-170`）。
   GUI 侧 02d 已有守卫，要核对收到后不会把轮次重复加一。
3. `session-run-state` 事件：`RunState`（`runner_manager/manager.rs:76-94`）任一字段变化时发出，camelCase。GUI 暂不监听；IPC 类型镜像按
   `check-ipc-protocol-drift` 的要求补。
4. 附件只读：按会话 id 加文件名，只读 `conversation-attachments/<session>/` 下的文件（`app_paths.rs:57`），拒绝越界路径和符号链接逃逸，
   返回字节与类型。只是 Core 函数，不接传输。
5. 配对主密钥：凭据存储键 `remote:pairing:mk` 的生成、读取、轮换。
6. `client` 列（原票 03，裁决 9）：迁移给 `messages`、`sessions` 加可空的 `client`，无 CHECK。桌面 GUI 发送与新建写 `desktop`，
   CLI、IM、agent 留空，手机的 `ios` 由 05b 写。补六处手写迁移列表；CLI JSON 不暴露，Rule 3 不动。
7. 消息分页：`persisted_message_rows` 加一个按 `before` / `limit` 取尾部的版本（第 6.3 节 `session.messages`）。

不做：远程模块本身、Tauri 命令、GUI 改动（IPC 类型镜像除外）。

### 05b — Core 远程模块（依赖 05a、05c）

- `core/src/remote/`：
  - 连接任务（tokio-tungstenite + rustls）、心跳与退避、`PEER` 处理；
  - 每台手机一个 Noise 响应方会话；
  - 第 6.3 节的方法分发，`device.registerPush` 存 prefs，`mint_session_id` 放宽可见性；
  - 第 6.4 节的事件转发：订阅、100ms 合批、按手机分开的有界队列、丢过增量就让手机重拉；
  - 推送发送接口，给票 08 用。
- relay 地址：编译期 `option_env!("GALLEY_REMOTE_RELAY_URL")`，运行时同名环境变量覆盖；两者都没有就不启动（第 2 节）。
- 只在已配对时连；启动和停止挂在 `start_background_services` 与托盘退出（第 7 节）。
- 测试：进程内起 relay（06a 已合入就直接用，否则写个最小的假 relay）加 Rust 写的假手机，跑通握手、`hello`、列会话、发送、事件、断线重连。

### 05d — 设置「手机」页（依赖 05b）

- 二维码、解除配对、连接状态；配对页检查「接通电源时保持唤醒」（票 04）和「关闭窗口时保持后台运行」（裁决 10）。视觉先本地预览给 JC。

### 06a — relay（依赖 05a）

- 第 4、8 节：频道表、外层帧转发、新 host 挤掉旧的、client 上限、限速、心跳超时、只听 127.0.0.1 的计数器、不记日志；进程内集成测试。

### 06b — APNs（依赖 06a；真机验证等 Apple 账号）

- 第 4.3 节：自己写 ES256 JWT，用 reqwest 走 HTTP/2；`PUSH` 转发给 APNs，`PUSH_RESULT` 回报结果（含 410）；用假 APNs 服务器测试。
- 实现（2026-10-10）：JWT 用 `ring` 签，HTTP/2 改用 hyper-util 加 hyper-rustls，不开 `reqwest` 的 `http2`（理由见第 4.3 节「APNs 客户端选型」）；
  细节见第 4.3 节「relay 侧发送」，测试见第 8 节。真机验证仍等 Apple 账号。

### 06c — 部署（依赖 06a、06b）

- galley 的 CI 出 `relay-v*` 构建产物；inkstone-ops 写 systemd 服务、Caddy 站点文件（`stream_close_delay`、不记访问日志）、DNS 子域、APNs 密钥在哪取。
- 动 frankfurt 和 DNS 之前问 JC，挑层台低峰。

### 07a — Swift 协议包（依赖 05a 的 golden；属票 07，没有界面所以先做）

- `ios/GalleyRemote/`（SwiftPM）：CryptoKit 上的 `NNpsk0`（裁决点 2 A）、外层帧、填充、推送解密、应用层 `Codable` 类型。
- 测试：cacophony 向量；解码 05a 的全部 golden；与 Rust 固定临时钥的握手结果逐字节一致。用 `swift test` 在 macOS 上跑；
  本机只有 Command Line Tools、没装 Xcode，测试框架能不能用待验。
- CI：按路径过滤的 macOS job（`.github/workflows/ios-protocol.yml`）。漂移检查并进了 Swift 测试，不另写 `check-remote-protocol-drift`（第 10 节）。

iOS 的工程与界面（票 07 其余部分）仍按产品定义的次序，等主聊天桌面形态定了再开（移动端产品定义「方案总览与次序」）。

## Comments

- 2026-10-10 JC 裁第 12 节：1、4、5 按推荐；2 问「什么是 iOS 侧的 Noise」，补了解释和漏列的选项 C（Rust 编译进 App），推荐仍是 A，待确认；
  3 JC 指出用户不接触 relay、不该是产品决策，核对后初稿「App 里会写死地址」与第 3.1 节二维码带地址自相矛盾，撤销该点，
  第 2 节补「relay 地址从哪来」（照更新地址先例编译期注入、二维码带给手机、运行时环境变量覆盖）。
- 2026-10-10 JC 裁第 2 点按推荐（A：CryptoKit 自写）；拆出第 13 节实现票，05a、05c 开工。
- 2026-10-10 06a（relay）实现：第 4.2 节补「client 连上先收到 host 在不在线」「挤掉旧 host 时 client 先收下线、再收上线」；
  第 4.4 节写定限速为背压、慢接收方 10 秒无进展即断、关闭码、推送接口、配置与计数器形状；第 8 节记测试覆盖。
  待 05b 对齐：`GALLEY_REMOTE_RELAY_URL` 按 05a 的 `RelayUrl` 填基础地址（开发时 `ws://127.0.0.1:8787`，不带 `/v1/connect`）。
- 2026-10-10 07a 完成 Swift 协议包 `ios/GalleyRemote/`：cacophony 三条向量和全部 golden 逐字节通过；漂移检查并入 Swift 测试，
  不另写 `check-remote-protocol-drift`（第 10 节）；第 9 节记了与 Rust 的差异和本机只有 Command Line Tools 时的测试办法。
- 2026-10-10 05b 实现：第 7 节补「05b 落定」，第 6.7 节记手机看得到的决定（两个新错误码、`via` 为 `ios` 等）；
  按 06a 的接口说明，relay 的关闭码一律退避重连，4001 只记一次日志。
- 2026-10-10 06b（APNs）实现：第 4.3 节补「relay 侧发送」（JWT 缓存与强制更换的频率上限、HTTP/2 连接、请求头与 24 小时过期、回应映射、
  四个变量全有或全无、计数器、relay 持有 APNs 密钥对 Rule 2 的影响）和选型的落定（`ring` 加 hyper-util，不开 `reqwest` 的 `http2`）；
  第 8 节记假 APNs 测试与 Core 的端到端测试；第 13 节 06b 记实现。未连真 APNs。
