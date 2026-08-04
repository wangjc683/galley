import * as Popover from "@radix-ui/react-popover";
import { CaretDown, Check } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

interface ManagedModelOptionPickerProps {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ManagedModelOptionPicker({
  value,
  options,
  placeholder,
  onChange,
  className,
}: ManagedModelOptionPickerProps) {
  const selectedValue = options.includes(value) ? value : "";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={placeholder}
          className={cn(
            "group flex w-full min-w-[240px] items-center justify-between gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-left",
            "outline-none hover:bg-hover focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            "data-[state=open]:border-brand data-[state=open]:bg-hover data-[state=open]:ring-[3px] data-[state=open]:ring-brand/20",
            className,
          )}
        >
          <span
            className={cn(
              "block min-w-0 truncate text-[12.5px]",
              selectedValue
                ? "font-mono text-ink"
                : "font-normal text-ink-muted",
            )}
            title={selectedValue || undefined}
          >
            {selectedValue || placeholder}
          </span>
          <CaretDown
            size={12}
            weight="bold"
            className={cn(
              "shrink-0 text-ink-muted transition-transform duration-(--motion-fast)",
              "group-hover:text-ink-soft group-data-[state=open]:rotate-180 group-data-[state=open]:text-ink-soft",
            )}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            "galley-pop-in z-[80] max-h-[280px] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-sm border border-line bg-elevated p-1 shadow-elevated",
          )}
        >
          {options.map((option, index) => {
            const selected = option === selectedValue;
            return (
              <Popover.Close asChild key={`${option}-${index}`}>
                <button
                  type="button"
                  title={option}
                  onClick={() => onChange(option)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left outline-none hover:bg-hover focus:bg-hover",
                    selected ? "text-ink" : "text-ink-soft",
                  )}
                >
                  <span className="flex w-3.5 shrink-0 items-center justify-center">
                    {selected && (
                      <Check
                        size={12}
                        weight="bold"
                        className="text-brand-strong"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                    {option}
                  </span>
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
