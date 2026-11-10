export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCE_CACHE_KEY = "galley_theme_preference";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readCachedThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const cached = window.localStorage.getItem(THEME_PREFERENCE_CACHE_KEY);
    return isThemePreference(cached) ? cached : "system";
  } catch {
    return "system";
  }
}

export function cacheThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, preference);
  } catch {
    // localStorage can be disabled in constrained WebViews. The
    // SQLite preference remains authoritative after hydrate.
  }
}

export function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme = resolveSystemTheme(),
): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function subscribeSystemTheme(
  callback: (theme: ResolvedTheme) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }

  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const notify = () => callback(query.matches ? "dark" : "light");

  if (query.addEventListener) {
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  }

  query.addListener(notify);
  return () => query.removeListener(notify);
}

export function runThemeFade(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const root = document.documentElement;
  root.classList.remove("theme-fade");
  // Force a reflow so back-to-back theme changes replay the short
  // acknowledgement instead of coalescing into one no-op class update.
  void root.offsetWidth;
  root.classList.add("theme-fade");
  window.setTimeout(() => root.classList.remove("theme-fade"), 160);
}
