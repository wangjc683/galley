/**
 * True when a keydown is the IME operating on its composition buffer
 * rather than a real key command — e.g. Enter confirming a pinyin
 * candidate, or Escape dismissing the candidate window. Key handlers
 * that submit / commit / cancel on such keys must early-return, or
 * confirming a candidate submits a half-composed draft.
 *
 * Two checks because engines disagree: Chromium delivers the
 * confirming keydown with `isComposing: true`; WebKit (Tauri's engine
 * on macOS) fires it *after* compositionend with `isComposing` already
 * false but keeps the legacy IME keyCode 229.
 */
export function isImeCompositionKeydown(e: {
  nativeEvent: KeyboardEvent;
}): boolean {
  return e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
}
