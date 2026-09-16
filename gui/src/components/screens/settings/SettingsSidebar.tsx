import {
  ChatCircleText,
  Cpu,
  Gear,
  Info,
  Keyboard,
  Key,
  Megaphone,
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
  // Chinese UI: the Chinese name is the primary label and the English
  // tab name drops to a secondary term anchor (it stays the identifier
  // that page headers and "Settings → Runtime" copy refer to). English
  // UI shows the English name alone. Community feedback 2026-09-16:
  // the previous English-primary / 10.5px-Chinese-annotation layout was
  // unreadable for users who don't read English.
  const chinesePrimary = isChineseLanguage(resolvedLanguage);
  const tabCopy = copy.settings.tabs;
  const labelsFor = (entry: { label: string; helper: string }) =>
    chinesePrimary
      ? { label: entry.helper, subLabel: entry.label }
      : { label: entry.label, subLabel: undefined };
  return (
    <nav className="flex w-[180px] shrink-0 flex-col border-r border-line bg-app py-3">
      <div>
        <SettingsTabButton
          active={tab === "general"}
          Icon={Gear}
          {...labelsFor(tabCopy.general)}
          onClick={() => onChange("general")}
        />
        <SettingsTabButton
          active={tab === "runtime"}
          Icon={Cpu}
          {...labelsFor(tabCopy.runtime)}
          onClick={() => onChange("runtime")}
        />
        <SettingsTabButton
          active={tab === "models"}
          Icon={Key}
          {...labelsFor(tabCopy.models)}
          onClick={() => onChange("models")}
        />
        <SettingsTabButton
          active={tab === "approval"}
          Icon={ShieldCheck}
          {...labelsFor(tabCopy.approval)}
          onClick={() => onChange("approval")}
        />
        <SettingsTabButton
          active={tab === "integration"}
          Icon={PlugsConnected}
          {...labelsFor(tabCopy.agent)}
          onClick={() => onChange("integration")}
        />
        {showImTab && (
          <SettingsTabButton
            active={tab === "im"}
            Icon={ChatCircleText}
            {...labelsFor(tabCopy.im)}
            onClick={() => onChange("im")}
          />
        )}
        {showBrowserTab && (
          <SettingsTabButton
            active={tab === "browser"}
            Icon={PuzzlePiece}
            {...labelsFor(tabCopy.browser)}
            onClick={() => onChange("browser")}
          />
        )}
        <SettingsTabButton
          active={tab === "shortcuts"}
          Icon={Keyboard}
          {...labelsFor(tabCopy.shortcuts)}
          onClick={() => onChange("shortcuts")}
        />
        <SettingsTabButton
          active={tab === "feedback"}
          Icon={Megaphone}
          {...labelsFor(tabCopy.feedback)}
          onClick={() => onChange("feedback")}
        />
        <SettingsTabButton
          active={tab === "about"}
          Icon={Info}
          {...labelsFor(tabCopy.about)}
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
          <span className="mt-0.5 block truncate text-ui-tertiary font-normal leading-[14px] text-ink-muted">
            {subLabel}
          </span>
        )}
      </span>
    </button>
  );
}
