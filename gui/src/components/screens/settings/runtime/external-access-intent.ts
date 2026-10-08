/**
 * One-shot "open 接入外部 GA when the Runtime tab next mounts" intent.
 *
 * 「跑一次 Health Check」 lives inside that accordion, but the round trip
 * closes Settings and takes over the window with Onboarding, so the
 * accordion's open state (component state) is gone when the user comes
 * back via 「返回设置」 / 「取消」. The onboarding flow raises this flag on
 * the way back; `SettingsRuntime` reads it for its initial expanded
 * state and clears it once mounted.
 *
 * Module state rather than a store: it only has to survive one
 * Settings close → reopen inside the same process, nothing renders
 * from it, and `App` (which owns the Settings open / tab state) does
 * not need to know.
 */
let expandExternalAccessOnMount = false;

export function requestExternalAccessExpanded(): void {
  expandExternalAccessOnMount = true;
}

/** Pure read, safe inside a `useState` initializer. */
export function isExternalAccessExpandRequested(): boolean {
  return expandExternalAccessOnMount;
}

export function clearExternalAccessExpandRequest(): void {
  expandExternalAccessOnMount = false;
}
