import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { CaretRight, Check, Monitor, Moon, Sun } from "@phosphor-icons/react";

import { TopBarIconButton } from "@/components/layout/TopBarIconButton";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemePreferenceMenu({
  preference,
  resolvedTheme,
  onChange,
  variant = "sidebar",
}: {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChange: (preference: ThemePreference) => void;
  variant?: "topbar" | "sidebar";
}) {
  const copy = useCopy();
  const options: Array<{
    value: ThemePreference;
    label: string;
    subLabel?: string;
    Icon: typeof Monitor;
  }> = [
    {
      value: "system",
      label: copy.theme.system,
      subLabel:
        resolvedTheme === "dark"
          ? copy.theme.currentDark
          : copy.theme.currentLight,
      Icon: Monitor,
    },
    { value: "light", label: copy.theme.light, Icon: Sun },
    { value: "dark", label: copy.theme.dark, Icon: Moon },
  ];

  const current = options.find((option) => option.value === preference);
  const actualTooltipLabel =
    resolvedTheme === "dark" ? copy.theme.currentDark : copy.theme.currentLight;
  const actualStatusLabel =
    resolvedTheme === "dark" ? copy.theme.dark : copy.theme.light;
  const triggerLabel = copy.theme.triggerLabel(
    current?.label ?? copy.theme.system,
    actualTooltipLabel,
  );
  const sidebarStatusLabel =
    preference === "system"
      ? `${actualStatusLabel} · ${copy.theme.system}`
      : (current?.label ?? actualStatusLabel);
  const ActualIcon = resolvedTheme === "dark" ? Moon : Sun;

  const menu = (
    <DropdownMenu.Content
      align="start"
      side="right"
      sideOffset={8}
      className={cn(
        "galley-pop-in z-[70] min-w-[176px] rounded-md border border-line bg-elevated p-1",
        "text-[13px] text-ink shadow-elevated",
      )}
    >
      {options.map((option) => (
        <DropdownMenu.Item
          key={option.value}
          onSelect={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
            "data-[highlighted]:bg-hover",
          )}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {option.value === preference && (
              <Check size={12} weight="bold" className="text-brand-strong" />
            )}
          </span>
          <option.Icon size={14} weight="thin" className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate">{option.label}</span>
            {option.subLabel && (
              <span className="block truncate text-[11px] text-ink-muted">
                {option.subLabel}
              </span>
            )}
          </span>
        </DropdownMenu.Item>
      ))}
    </DropdownMenu.Content>
  );

  // Topbar variant mirrors the conversation font-size control next to
  // it: icon trigger → small Popover → shared SegmentedControl. Popover
  // (not DropdownMenu) on purpose — it stays open after a pick so the
  // user can flip themes and compare live. The "system" sub-state
  // ("当前浅色") moves to a caption line under the segments; the
  // sidebar variant below keeps the menu form, where list rows
  // naturally open side menus and sublabels have room. No persistent
  // tint for non-system preferences — a settled preference is standing
  // noise, not information; state lives in the tooltip and popover.
  if (variant === "topbar") {
    return (
      <Popover.Root>
        <TooltipLabel text={triggerLabel} side="bottom">
          <Popover.Trigger asChild>
            <TopBarIconButton aria-label={triggerLabel}>
              <ActualIcon size={16} weight="thin" />
            </TopBarIconButton>
          </Popover.Trigger>
        </TooltipLabel>
        <Popover.Portal>
          <Popover.Content
            align="end"
            side="bottom"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              // Same as the font-size control: suppress Radix's open
              // autofocus so no stray focus ring lands on the first
              // segment. The active thumb already shows the current
              // preference; keyboard users can still Tab / arrow in.
              event.preventDefault();
            }}
            className="galley-pop-in z-[70] rounded-md border border-line bg-elevated p-1.5 shadow-elevated"
          >
            {/* No per-segment icons here, matching the font-size
                popover next to it: once the panel is open each option
                carries a text label, so the sun/moon glyphs are
                redundant. Their real recognition value lives in the
                topbar trigger (ActualIcon above), which stays. */}
            <SegmentedControl<ThemePreference>
              value={preference}
              ariaLabel={copy.theme.aria}
              onValueChange={onChange}
              options={[
                { value: "system", label: copy.theme.system },
                { value: "light", label: copy.theme.light },
                { value: "dark", label: copy.theme.dark },
              ]}
            />
            {preference === "system" && (
              <div className="px-1 pb-0.5 pt-1.5 text-[11px] text-ink-muted">
                {actualTooltipLabel}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left",
            "text-ink-soft outline-none hover:bg-hover hover:text-ink",
            "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm active:translate-y-px",
            "focus-visible:ring-2 focus-visible:ring-brand/30",
            "data-[state=open]:bg-hover data-[state=open]:text-ink",
          )}
          aria-label={copy.theme.aria}
        >
          <ActualIcon size={15} weight="thin" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] leading-4">
              {copy.theme.button}
            </span>
            <span className="block truncate text-[11px] leading-3 text-ink-muted">
              {sidebarStatusLabel}
            </span>
          </span>
          <CaretRight
            size={11}
            weight="bold"
            className="shrink-0 text-ink-muted group-hover:text-ink-soft"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>{menu}</DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
