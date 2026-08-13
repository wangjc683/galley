# 打包缺口：bundled Python 没装 python-telegram-bot，正式包里 Telegram Channel 起不来

Status: done
日期：2026-08-13
来源：Discord Channel 接入调研（JC + agent）的副产物；与 Discord 决策
**解耦**单独立项——不管 Discord 做不做，这个缺口都在。

## 现象（已在本机验证）

三处证据链：

- `scripts/bundle-python.sh:26-36` 的 `GA_DEPS` 列表里有 `lark-oapi==1.6.8`
  （飞书），但**没有任何 telegram 包**；`managed-ga/code/pyproject.toml:33`
  声明的 `python-telegram-bot>=20.0` 不会被打包脚本安装（脚本装的是
  `GA_DEPS` 显式清单，不读 pyproject）。
- 本机 `core/python-bundle/python/.../site-packages/` 实测：有 `lark_oapi`，
  无 `telegram` / `python_telegram_bot`。
- 冒烟门禁 `scripts/check-bundled-python-managed-ga.sh` 的 import 检查
  也不含 `telegram`，所以打包流水线不会拦住这个缺口。

## 后果

正式 bundle 里启动 Telegram Channel 时，
`runner/managed_im_supervisor.py:438-442` 的 import 兜底会把
`ModuleNotFoundError` 报成 channel `error` 状态（`import failed: …`）——
不是崩溃，但用户视角就是「Telegram 服务永远起不来」。

开发机上如果 bundled python 曾被手动 pip 装过、或 dogfood 走的是外部
环境，这个缺口会被掩盖——这大概是它存活至今的原因。

## 修复要点

1. `GA_DEPS` 加 `python-telegram-bot==<pin>`（对齐 pyproject 的 `>=20.0`，
   选一个与 tgapp 兼容的具体版本钉死，和其余条目的钉版风格一致）。
2. 冒烟门禁加 `import telegram`（或直接尝试 import tgapp 的依赖面）。
3. 重出 bundle 后，用真实 bundle（非开发环境）把 Telegram Channel 起一遍
   作为验收。
4. 前瞻：将来接 Discord 时 `discord.py` 同样不在 GA 的 pyproject 依赖里
   （上游只在 `configure_mykey.py` 的元数据里提了一句），**必须**同步进
   `GA_DEPS` + 冒烟门禁，别复制这个缺口。见
   [Discord Channel PRD](../../discord-channel/PRD.md)。

## Comments

- 2026-08-13（agent）：已修。`GA_DEPS` 加 `python-telegram-bot==22.8`
  （pip index 当日最新，满足 pyproject `>=20.0`）；冒烟门禁加
  `import telegram` + `find_spec("frontends.tgapp")`。本机 bundle 实测：
  pip 装入 22.8 → 门禁 OK → tgapp 的六行 from-import 逐一验过
  （含 `telegram.request.HTTPXRequest`）。剩余验收：下次出正式 bundle
  时从零重跑 `bundle-python.sh` 并在真实包里把 Telegram 服务起一遍
  （需要真 bot token，留给 JC dogfood / 下个 release 周期）。
