import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyResolvedTheme,
  resolveSystemTheme,
  resolveThemePreference,
  runThemeFade,
  subscribeSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/** Resolves the effective theme from the preference + live system
 * scheme, applies it to the document, and cross-fades on changes
 * after the initial paint. */
export function useThemeEffects({
  themePreference,
}: {
  themePreference: ThemePreference;
}): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState(resolveSystemTheme);
  const resolvedTheme = useMemo(
    () => resolveThemePreference(themePreference, systemTheme),
    [themePreference, systemTheme],
  );

  useEffect(() => subscribeSystemTheme(setSystemTheme), []);

  const themeAppliedRef = useRef(false);
  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
    if (themeAppliedRef.current) {
      runThemeFade();
    } else {
      themeAppliedRef.current = true;
    }
  }, [resolvedTheme]);

  return resolvedTheme;
}
