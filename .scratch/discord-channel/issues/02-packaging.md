# 打包与门禁：discord.py 进 bundle

Status: ready-for-agent
日期：2026-08-13

- `scripts/bundle-python.sh` `GA_DEPS` 加 `discord.py==<pin>`（照
  telegram 22.8 的钉版方式选当日最新稳定版）。
- `scripts/check-bundled-python-managed-ga.sh` 加 `import discord` +
  `find_spec("frontends.dcapp")`。
- `scripts/check-managed-ga-payload.mjs` 把 `dcapp.py` 列为必须文件。
- 本机 bundle 实测 import 面（含补丁后 dcapp 的全部 from-import）。

先例：`.scratch/telegram-bundle-dep/`（勿复制当年 Telegram 的缺口）。
