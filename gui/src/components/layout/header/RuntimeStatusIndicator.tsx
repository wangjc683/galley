import { Cpu } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";

import { TopBarIconButton } from "../TopBarIconButton";
import type { RuntimeIndicator } from "./runtime-indicator";
import { topBarStatusBadgeClass } from "./topbar-status-badge";

/**
 * Engine (内核) state in the status cluster. A setup gap — the bundled
 * engine has no usable model, or the external GA isn't configured — is
 * a text badge that opens the Settings tab that fixes it; an external
 * GA in use is a quiet Cpu icon (the Settings → Runtime tab's icon, as
 * Browser Control ↔ PuzzlePiece, Channels ↔ ChatCircleText) that opens
 * Runtime. Neutral tone on purpose: in the sidebar these sat behind a
 * muted grey dot, and moving them must not escalate their severity.
 */
export function RuntimeStatusIndicator({
  indicator,
  onOpenRuntime,
  onOpenModels,
}: {
  indicator: Exclude<RuntimeIndicator, "hidden">;
  onOpenRuntime?: () => void;
  onOpenModels?: () => void;
}) {
  const copy = useCopy().topbar;

  if (indicator === "external-ready") {
    return (
      <TooltipLabel text={copy.usingExternalGA}>
        <TopBarIconButton
          onClick={onOpenRuntime}
          aria-label={copy.usingExternalGAAria}
        >
          <Cpu size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  const badge =
    indicator === "configure-models"
      ? {
          label: copy.configureModels,
          title: copy.bundledNeedsModel,
          ariaLabel: copy.openModelsForBundled,
          onOpen: onOpenModels,
        }
      : {
          label: copy.connectExternalGA,
          title: copy.chooseExistingGAFolder,
          ariaLabel: copy.openRuntimeForExternal,
          onOpen: onOpenRuntime,
        };

  return (
    <TooltipLabel text={badge.title}>
      <button
        type="button"
        onClick={badge.onOpen}
        aria-label={badge.ariaLabel}
        className={topBarStatusBadgeClass("neutral")}
      >
        {badge.label}
      </button>
    </TooltipLabel>
  );
}
