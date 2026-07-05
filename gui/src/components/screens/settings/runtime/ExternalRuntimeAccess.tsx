import type { ReactNode } from "react";

import { useCopy } from "@/lib/i18n";
import type { RuntimeKind } from "@/types/session";

import { ExternalRuntimeCard } from "./ExternalRuntimeCard";
import { RuntimeAccordionRow } from "./RuntimeAccordionRow";

export function ExternalRuntimeAccess({
  expanded,
  value,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  onToggleExpanded,
  onActivate,
  children,
}: {
  expanded: boolean;
  value: RuntimeKind;
  hasExternalRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  onToggleExpanded: () => void;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const copy = useCopy().settings.runtime;
  const active = value === "external";
  return (
    <RuntimeAccordionRow
      title={copy.connectExternalGA}
      badge={
        active ? (
          <span className="rounded-sm bg-hover px-1.5 py-px text-ui-micro text-ink-muted">
            {copy.active}
          </span>
        ) : undefined
      }
      expanded={expanded}
      onToggle={onToggleExpanded}
    >
      <div className="space-y-5">
        <ExternalRuntimeCard
          value={value}
          hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
          hasRunningSessions={hasRunningSessions}
          onActivate={onActivate}
        />
        {children}
      </div>
    </RuntimeAccordionRow>
  );
}
