# 打包与门禁：discord.py 进 bundle

Status: done
日期：2026-08-13

- `scripts/bundle-python.sh` `GA_DEPS` 加 `discord.py==<pin>`（照
  telegram 22.8 的钉版方式选当日最新稳定版）。
- `scripts/check-bundled-python-managed-ga.sh` 加 `import discord` +
  `find_spec("frontends.dcapp")`。
- `scripts/check-managed-ga-payload.mjs` 把 `dcapp.py` 列为必须文件。
- 本机 bundle 实测 import 面（含补丁后 dcapp 的全部 from-import）。

先例：`.scratch/telegram-bundle-dep/`（勿复制当年 Telegram 的缺口）。

## Comments

- 2026-08-13（agent）：已实施，只碰 `scripts/` 下三个文件。
  - 选版：bundled python 跑 `pip index versions discord.py` → 当日最新稳定版
    `2.7.1`（上一版 2.7.0）。`GA_DEPS` 加 `"discord.py==2.7.1"`，紧跟
    `python-telegram-bot==22.8` 之后，钉版风格与 telegram 先例一致。
  - 门禁：`check-bundled-python-managed-ga.sh` 按字母序在 `bs4` 与 `dotenv`
    之间插入 `import discord`，断言区加 `assert discord is not None`，
    find_spec 区加 `frontends.dcapp`（跟在 wechatapp / fsapp / tgapp 之后）。
    `check-managed-ga-payload.mjs` 的 requireFile 清单加
    `frontends/dcapp.py`。
  - 实测（本机 bundle）：`pip install discord.py==2.7.1` 装入
    `core/python-bundle` → `scripts/check-bundled-python-managed-ga.sh` 全绿
    （`managed GA import OK` / `OK`）→ `node scripts/check-managed-ga-payload.mjs`
    输出 `[managed-ga-payload] OK`。
  - 兼容面核对：`frontends/dcapp.py` 对 discord 只有 `import discord` 一处
    （没有 from-import 面，与 tgapp 不同），用到的符号逐个在 2.7.1 上验过：
    `discord.__version__ == "2.7.1"`、`Intents.default()` + `message_content`、
    `Client`（`__init__(*, intents, **options)`，源码里 `options.pop('proxy')`
    确认 dcapp 传的 `proxy=` 仍受支持）、`DMChannel`、`Thread`、`File`、
    `Messageable.send(file=…)`。因另一并行任务在改 dcapp.py，全程只用
    `find_spec` 不 import 模块本体，门禁不受其状态影响。
  - 剩余验收：下次出正式包时从零重跑 `bundle-python.sh`，并在真实 bundle 里
    用真 bot token 把 Discord 服务起一遍（同 telegram 先例，留给 dogfood）。
