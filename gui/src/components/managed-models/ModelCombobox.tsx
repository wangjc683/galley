import * as Popover from "@radix-ui/react-popover";
import { CaretDown, Check } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const VISIBLE_OPTIONS_CAP = 80;

/** What the combobox hands to the host's text field. Spread it onto
 * `SetupInput` / `SettingsInput` — the field keeps its surface's own
 * grammar, the combobox only owns the caret and the dropdown. */
export interface ModelComboboxField {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  trailing: ReactNode;
  reserveTrailing: true;
}

/**
 * The fetched model list as candidates *for the model field* rather
 * than a sibling section: the input stays put, a caret lights up in
 * its trailing slot once a list is present, and picking fills the
 * field. Typing filters the open list; the caret shows the whole list
 * so a prefilled model doesn't hide its siblings. Keyboard: ↓ opens,
 * ↑/↓ move, Enter picks, Esc closes. Focus never leaves the input.
 */
export function ModelCombobox({
  value,
  options,
  placeholder,
  onChange,
  children,
}: {
  value: string;
  options: string[];
  /** Placeholder while no list has arrived (the preset's suggestion). */
  placeholder: string;
  onChange: (value: string) => void;
  children: (field: ModelComboboxField) => ReactNode;
}) {
  const copy = useCopy().settings.models;
  const [openRequested, setOpen] = useState(false);
  // "" = show everything (caret / ↓ opened it); typing narrows it.
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hasOptions = options.length > 0;
  // The list resets when key / endpoint change — the dropdown closes
  // along with it (derived, so no effect is needed).
  const open = openRequested && hasOptions;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        option.toLowerCase().includes(normalizedQuery),
      )
    : options;
  const visibleOptions = filteredOptions.slice(0, VISIBLE_OPTIONS_CAP);
  const selectedValue = value.trim();

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const focusInput = () => {
    anchorRef.current?.querySelector("input")?.focus();
  };

  const openAll = () => {
    setQuery("");
    setActiveIndex(Math.max(0, options.indexOf(selectedValue)));
    setOpen(true);
  };

  const pick = (option: string) => {
    onChange(option);
    setQuery("");
    setOpen(false);
  };

  const handleInputChange = (next: string) => {
    onChange(next);
    if (!hasOptions) return;
    setQuery(next);
    setActiveIndex(0);
    setOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!hasOptions) return;
    if (!open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openAll();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) =>
          visibleOptions.length === 0
            ? 0
            : Math.min(index + 1, visibleOptions.length - 1),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Enter": {
        const option = visibleOptions[activeIndex];
        if (option !== undefined) {
          event.preventDefault();
          pick(option);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const field: ModelComboboxField = {
    value,
    onChange: handleInputChange,
    onKeyDown: handleKeyDown,
    placeholder:
      hasOptions && selectedValue === ""
        ? copy.modelsFoundPickHint(options.length)
        : placeholder,
    reserveTrailing: true,
    trailing: hasOptions ? (
      <IconButton
        ariaLabel={copy.browseDetectedModels}
        tooltip={false}
        size="xs"
        className="size-6 text-ink-muted hover:text-ink-soft"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openAll();
          }
          focusInput();
        }}
      >
        <CaretDown
          size={13}
          weight="bold"
          className={cn(
            "transition-transform duration-(--motion-fast)",
            open && "rotate-180",
          )}
        />
      </IconButton>
    ) : null,
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div ref={anchorRef}>{children(field)}</div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // The Settings Dialog's scroll lock cancels wheel / touchmove
          // events that reach `document` from portaled content. Stop them
          // here so the list scrolls. We cannot use `modal` on the Popover
          // like ManagedModelProviderPicker does: modal traps focus inside
          // the list and would steal it from the input while typing.
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          onInteractOutside={(event) => {
            // Clicking back into the field is not "outside" — the
            // input keeps the list open while the user keeps typing.
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
          className={cn(
            "galley-pop-in z-[80] w-[var(--radix-popover-trigger-width)] rounded-sm border border-line bg-elevated p-1 shadow-elevated",
          )}
        >
          <div
            ref={listRef}
            role="listbox"
            className="max-h-[280px] overflow-auto"
          >
            {visibleOptions.length === 0 && (
              <div className="px-2.5 py-2 text-[12px] text-ink-muted">
                {copy.noMatchingModels}
              </div>
            )}
            {visibleOptions.map((option, index) => {
              const selected = option === selectedValue;
              const active = index === activeIndex;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={active}
                  title={option}
                  onMouseEnter={() => setActiveIndex(index)}
                  // Mouse down would blur the input before click fires;
                  // keep focus where the keyboard expects it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left outline-none",
                    active && "bg-hover",
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
              );
            })}
          </div>
          {filteredOptions.length > visibleOptions.length && (
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-ink-muted">
              {copy.visibleOptionsHint(visibleOptions.length)}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
