import {
  ChatCircleText,
  Cpu,
  Gear,
  Info,
  Keyboard,
  Key,
  PlugsConnected,
  PuzzlePiece,
  ShieldCheck,
} from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { isChineseLanguage, type ResolvedLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";

import type { SettingsTab } from "./settings-types";

export function SettingsSidebar({
  tab,
  onChange,
  resolvedLanguage,
  showImTab,
  showBrowserTab,
}: {
  tab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  resolvedLanguage: ResolvedLanguage;
  showImTab: boolean;
  showBrowserTab: boolean;
}) {
  const copy = useCopy();
  const showChineseHelpers = isChineseLanguage(resolvedLanguage);
  const tabCopy = copy.settings.tabs;
  return (
    <nav className="flex w-[180px] shrink-0 flex-col border-r border-line bg-app py-3">
      <div>
        <SettingsTabButton
          active={tab === "general"}
          Icon={Gear}
          label={tabCopy.general.label}
          subLabel={showChineseHelpers ? tabCopy.general.helper : undefined}
          onClick={() => onChange("general")}
        />
        <SettingsTabButton
          active={tab === "runtime"}
          Icon={Cpu}
          label={tabCopy.runtime.label}
          subLabel={showChineseHelpers ? tabCopy.runtime.helper : undefined}
          onClick={() => onChange("runtime")}
        />
        <SettingsTabButton
          active={tab === "models"}
          Icon={Key}
          label={tabCopy.models.label}
          subLabel={showChineseHelpers ? tabCopy.models.helper : undefined}
          onClick={() => onChange("models")}
        />
        <SettingsTabButton
          active={tab === "approval"}
          Icon={ShieldCheck}
          label={tabCopy.approval.label}
          subLabel={showChineseHelpers ? tabCopy.approval.helper : undefined}
          onClick={() => onChange("approval")}
        />
        <SettingsTabButton
          active={tab === "integration"}
          Icon={PlugsConnected}
          label={tabCopy.agent.label}
          subLabel={showChineseHelpers ? tabCopy.agent.helper : undefined}
          onClick={() => onChange("integration")}
        />
        {showImTab && (
          <SettingsTabButton
            active={tab === "im"}
            Icon={ChatCircleText}
            label={tabCopy.im.label}
            subLabel={showChineseHelpers ? tabCopy.im.helper : undefined}
            onClick={() => onChange("im")}
          />
        )}
        {showBrowserTab && (
          <SettingsTabButton
            active={tab === "browser"}
            Icon={PuzzlePiece}
            label={tabCopy.browser.label}
            subLabel={showChineseHelpers ? tabCopy.browser.helper : undefined}
            onClick={() => onChange("browser")}
          />
        )}
        <SettingsTabButton
          active={tab === "shortcuts"}
          Icon={Keyboard}
          label={tabCopy.shortcuts.label}
          subLabel={showChineseHelpers ? tabCopy.shortcuts.helper : undefined}
          onClick={() => onChange("shortcuts")}
        />
        <SettingsTabButton
          active={tab === "about"}
          Icon={Info}
          label={tabCopy.about.label}
          subLabel={showChineseHelpers ? tabCopy.about.helper : undefined}
          onClick={() => onChange("about")}
        />
      </div>
    </nav>
  );
}

function SettingsTabButton({
  active,
  Icon,
  label,
  subLabel,
  onClick,
}: {
  active: boolean;
  Icon: typeof Cpu;
  label: string;
  subLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-3 px-4 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
        subLabel ? "h-[50px]" : "h-8 text-ui-compact",
        active ? "bg-hover" : "hover:bg-hover",
      )}
    >
      {active && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-ink"
          aria-hidden
        />
      )}
      <Icon
        size={16}
        weight="thin"
        className={cn(
          "shrink-0",
          active ? "text-ink" : "text-ink-soft group-hover:text-ink",
        )}
      />
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={cn(
            "block truncate text-[14px] font-medium leading-[18px]",
            active ? "text-ink" : "text-ink-soft group-hover:text-ink",
          )}
        >
          {label}
        </span>
        {subLabel && (
          <span
            className={cn(
              "mt-1 block truncate text-[10.5px] font-normal leading-[11px]",
              active ? "text-ink-muted" : "text-ink-muted/75",
            )}
          >
            {subLabel}
          </span>
        )}
      </span>
    </button>
  );
}
