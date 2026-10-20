/**
 * The model menu's pure rules (LLMPill, docs/design/conversation.md
 * 「LLM 切换器」 → Popover 结构).
 */

interface LLMMenuOption {
  key?: string;
  displayName: string;
}

/** Whether this option spends the ChatGPT plan: its `key` (the managed
 * model id) is among the plan's. */
export function isChatGptPlanOption(
  planKeys: ReadonlySet<string> | undefined,
  option: Pick<LLMMenuOption, "key"> | undefined,
): boolean {
  return !!planKeys && !!option?.key && planKeys.has(option.key);
}

/**
 * Per option, whether its provider label stays shown instead of
 * appearing on hover only. Two rows with the same display name can't be
 * told apart by the name, so the label stays (2026-05-28, 9f56cabd) —
 * unless the ChatGPT mark already tells them apart: a plan row and a
 * row that is not on the plan (SIWC decision 14). Rows the mark can't
 * separate — both on the plan, or both not — keep the label.
 */
export function providerLabelAlwaysShown(
  options: readonly LLMMenuOption[],
  planKeys: ReadonlySet<string> | undefined,
): boolean[] {
  const identity = (option: LLMMenuOption) =>
    `${isChatGptPlanOption(planKeys, option) ? "plan" : "other"}\u0000${option.displayName.trim()}`;
  const counts = new Map<string, number>();
  for (const option of options) {
    const id = identity(option);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return options.map((option) => (counts.get(identity(option)) ?? 0) > 1);
}
