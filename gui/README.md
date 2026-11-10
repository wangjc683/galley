# Galley Desktop

Tauri v2 + React 19 + TypeScript + Tailwind v4. macOS-first.

See `../AGENTS.md` for project-wide conventions; this README is just the dev quickstart.

## Dev

```bash
pnpm install
pnpm tauri dev      # 启 Tauri 桌面窗口（首次会编译 Rust，慢）
pnpm dev            # 仅 Vite frontend，浏览器调试用
```

## Quality gates

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint flat config，0 warning
pnpm format         # Prettier 写入
pnpm build          # tsc + vite build（不打 Tauri bundle）
pnpm tauri build    # 打 .app / .dmg
```

## 设计 tokens

`src/styles/globals.css` 的 `@theme` block 是 light theme 基线；
`html[data-theme="dark"]` 覆盖同一套语义 token。主题偏好走
`prefs.theme_preference`，并同步 `localStorage.galley_theme_preference`
给首屏防闪白脚本使用。

## Managed models + Channels

Managed model edits write the generated non-secret config and refresh
`prefs.managed_model_config_revision`. Channel processes record the revision
they started with; when it falls behind, the UI offers `Restart Channels`.
That action restarts enabled Channel processes without logging the user out.

## IPC types

`src/types/ipc.ts` 镜像 `../runner/ipc.py` 与 `../core/src/ipc.rs`。协议改时四处同改：`docs/ipc-protocol.md` → `runner/ipc.py` → `core/src/ipc.rs` → `gui/src/types/ipc.ts`，步骤见 [engineering-workflow](../docs/engineering-workflow.md#ipc-protocol-changes)。
