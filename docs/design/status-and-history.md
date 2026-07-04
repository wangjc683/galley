# 未决事项与历史对照

> Galley 设计系统 · 原 DESIGN.md §11–§12（2026-07-04 拆分）：当前 open 问题、推到未来版本的扩展、与 Notion 历史稿的关系。

## 11. 已知未决与扩展方向

### 当前 beta 范围内 open

- **Settings 是否升级为独立窗口**：当前 modal 够用；只有当用户需要边看 session 边改设置的频率被 dogfood 证实时再升级。
- **Composer LLM dropdown 在 long LLM list 下的 UX**：V0.1 不做特殊处理，超过 8 个加 scroll
- **Onboarding 走完后下次启动是否每次跑 Health Check**：建议**后台**重新跑（不阻塞 UI），失败时弹 toast；V0.2 desktop 阶段验证
- **按钮与图标 primitive 收口**：当前仍存在 raw button / raw glyph drift，需要分阶段收。
- **暖色 token 的层级校准**：当前底色一致性足够，但 brand / selected / hover / warning 的使用边界还需要更明确，避免全局一片杏沙。

### 推到未来版本的设计扩展

- **Dark mode**：light-first token 已预留命名空间（`surface-dark` 系列待补）
- **`file_write` 内容预览**：依赖 GA 上游把 `extract_robust_content` 前置到 dispatch，可以是给 GA 的 PR
- **Slash commands** in Composer（`/restore` `/new` 等）
- **Cross-session 全文搜索**（Command Palette `#` prefix）
- **Custom LLM displayName**（Settings → LLM tab）
- **拖拽 session 到 Project**（V0.1 用右键 + hover `⋯`）
- **Trees / file explorer**（如果 V0.2+ 加 file inspector，候选 [trees.software](https://trees.software) + [@pierre/diffs](https://diffs.com) 配套）

---

## 12. 与 Notion 历史稿的关系

- v0.1 完整版（dark-first / Linear 风）保留在 Notion 作为历史对照（page id `3552aab6e913815f91a1c2b8b0a15672`）
- 当前权威版本在本仓库 `docs/DESIGN.md` + devlog
- Notion 不再作为当前实现 spec 的同步源；避免同一设计基准出现两个真源

完整决策叙事见 `docs/devlog/`：

- `2026-05-07-design-direction-pivot.md` — Notion + Claude 转向，9 块基础对齐
- `2026-05-08-onboarding-and-llm-switching.md` — Onboarding / Empty / Health Check / LLM 切换
- `2026-05-08-design-trio-finale.md` — Error Card / Command Palette / Settings + file_patch diff
