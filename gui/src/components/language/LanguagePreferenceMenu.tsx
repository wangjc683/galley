import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretDown, CaretRight, Check, Translate } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import {
  isChineseLanguage,
  type LanguagePreference,
  type ResolvedLanguage,
} from "@/lib/language";
import { cn } from "@/lib/utils";

export function LanguagePreferenceMenu({
  preference,
  resolvedLanguage,
  onChange,
  variant = "sidebar",
}: {
  preference: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
  onChange: (preference: LanguagePreference) => void;
  variant?: "sidebar" | "compact";
}) {
  const copy = useCopy();
  const isChinese = isChineseLanguage(resolvedLanguage);
  const resolvedLabel =
    resolvedLanguage === "zh-CN" ? copy.language.zh : copy.language.en;
  const resolvedCurrentLabel = copy.language.current(resolvedLabel);
  const options: Array<{
    value: LanguagePreference;
    label: string;
    subLabel?: string;
  }> = isChinese
    ? [
        {
          value: "system",
          label: copy.language.system,
          subLabel: resolvedCurrentLabel,
        },
        { value: "zh-CN", label: copy.language.zh },
        { value: "en-US", label: copy.language.en },
      ]
    : [
        {
          value: "system",
          label: copy.language.system,
          subLabel: resolvedCurrentLabel,
        },
        { value: "zh-CN", label: copy.language.zh },
        { value: "en-US", label: copy.language.en },
      ];
  const current = options.find((option) => option.value === preference);
  const compactLabel = current?.label;
  const sidebarStatusLabel =
    current?.value === "system"
      ? `${resolvedLabel} · ${copy.language.system}`
      : (current?.label ?? resolvedLabel);
  const compact = variant === "compact";
  const ChevronIcon = compact ? CaretDown : CaretRight;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            compact
              ? "inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[12px]"
              : "group flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left",
            "text-ink-soft outline-none hover:bg-hover hover:text-ink",
            "data-[state=open]:bg-hover data-[state=open]:text-ink",
          )}
          aria-label={copy.language.aria}
        >
          <Translate
            size={compact ? 14 : 15}
            weight="thin"
            className="shrink-0"
          />
          {compact ? (
            <span className="max-w-[72px] truncate">
              {compactLabel ?? copy.language.system}
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] leading-4">
                {copy.language.button}
              </span>
              <span className="block truncate text-[11px] leading-3 text-ink-muted">
                {sidebarStatusLabel}
              </span>
            </span>
          )}
          <ChevronIcon
            size={compact ? 10 : 11}
            weight="bold"
            className={cn(
              "shrink-0",
              compact
                ? ""
                : "text-ink-muted group-hover:text-ink-soft",
            )}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={compact ? "end" : "start"}
          side={compact ? "bottom" : "right"}
          sideOffset={compact ? 6 : 8}
          className={cn(
            "z-[70] min-w-[160px] rounded-md border border-line bg-elevated p-1",
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
                  <Check
                    size={12}
                    weight="bold"
                    className="text-brand-strong"
                  />
                )}
              </span>
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
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
