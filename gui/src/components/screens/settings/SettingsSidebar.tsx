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
  // tab name drops to a secondary term anchor (since 2026-10-07 page
  // headers and "设置 → 运行环境" copy use the Chinese name too, so this
  // sub-label is the only place it shows). English UI shows the English
  // name alone. Community feedback 2026-09-16:
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
      {/* Three groups, separated by space only (no rules): everyday setup
          (general / models / browser / channels), agent and engine
          plumbing (agent access / runtime / shortcuts), then meta
          (feedback / about). Browser and Channels exist only on the
          managed runtime; general and models keep group one non-empty
          in external mode, so no gap ever renders without tabs. */}
      <div className="flex flex-col gap-3">
        <div>
          <SettingsTabButton
            active={tab === "general"}
            Icon={Gear}
            {...labelsFor(tabCopy.general)}
            onClick={() => onChange("general")}
          />
          <SettingsTabButton
            active={tab === "models"}
            Icon={Key}
            {...labelsFor(tabCopy.models)}
            onClick={() => onChange("models")}
          />
          {showBrowserTab && (
            <SettingsTabButton
              active={tab === "browser"}
              Icon={PuzzlePiece}
              {...labelsFor(tabCopy.browser)}
              onClick={() => onChange("browser")}
            />
          )}
          {showImTab && (
            <SettingsTabButton
              active={tab === "im"}
              Icon={ChatCircleText}
              {...labelsFor(tabCopy.im)}
              onClick={() => onChange("im")}
            />
          )}
        </div>
        <div>
          <SettingsTabButton
            active={tab === "integration"}
            Icon={PlugsConnected}
            {...labelsFor(tabCopy.agent)}
            onClick={() => onChange("integration")}
          />
          <SettingsTabButton
            active={tab === "runtime"}
            Icon={Cpu}
            {...labelsFor(tabCopy.runtime)}
            onClick={() => onChange("runtime")}
          />
          <SettingsTabButton
            active={tab === "shortcuts"}
            Icon={Keyboard}
            {...labelsFor(tabCopy.shortcuts)}
            onClick={() => onChange("shortcuts")}
          />
        </div>
        <div>
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
        subLabel ? "h-[50px]" : "h-8",
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
