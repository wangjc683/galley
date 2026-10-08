/**
 * The inline code chip in Settings prose: sunk `bg-app` with a hairline,
 * so it reads on the page, a `bg-surface` list row, and a tinted panel
 * alike. `InlineCodeText` renders it from backtick pairs; the Channels
 * command table and Feishu setup steps use it directly.
 */
export const INLINE_CODE_CLASS =
  "rounded-sm border border-line/80 bg-app px-1 py-[1px] font-mono text-ui-tertiary text-ink";
