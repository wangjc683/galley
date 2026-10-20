import { useState } from "react";

/** `initialExpanded`: the cards open on arrival (Settings asked for with
 * the ChatGPT card open, SIWC ticket 04); read once, on mount. */
export function useProviderExpansion(
  initialExpanded: () => string[] = () => [],
) {
  const [expandedProviderIds, setExpandedProviderIds] =
    useState<string[]>(initialExpanded);

  const expandProvider = (id: string) => {
    setExpandedProviderIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  };

  const isProviderExpanded = (id: string) => expandedProviderIds.includes(id);

  const toggleProvider = (id: string) => {
    if (isProviderExpanded(id)) {
      setExpandedProviderIds((current) =>
        current.filter((item) => item !== id),
      );
      return;
    }
    expandProvider(id);
  };

  return {
    expandProvider,
    isProviderExpanded,
    toggleProvider,
  };
}
