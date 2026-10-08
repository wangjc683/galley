import { ArrowRight, CaretRight } from "@phosphor-icons/react";
import type { ReactNode, Ref } from "react";

import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * Settings' two expandable-row families (2026-10-07 cross-tab audit, D4).
 * Both use one caret: a single CaretRight that rotates 90° when open
 * (caret = expand in place). Navigation rows keep an arrow instead
 * (arrow = go somewhere else).
 *
 * - `SettingsDisclosureCard` — an independent bordered card that opens
 *   downward (Models providers, Channels, the advanced-config folds).
 *   Caret on the left, before the card's own identity (logo / name /
 *   badges); optional trailing actions sit outside the toggle.
 * - `SettingsDisclosureList` + `SettingsDisclosureRow` / `SettingsNavRow`
 *   — rows inside one hairline-divided bordered list (Runtime 「更多」,
 *   Agent 「高级选项」). Caret on the right; the whole row is the toggle.
 */

const CARET_MOTION =
  "transition-[color,transform] duration-(--motion-fast) ease-firm motion-reduce:transition-none";

export function SettingsDisclosureCard({
  open,
  onToggle,
  header,
  actions,
  actionsPinned = false,
  notice,
  animateBody = false,
  surface = "card",
  rootRef,
  bodyClassName,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** Toggle contents after the caret: glyph, name, badges. Laid out in a
   * `flex min-w-0 flex-1 items-center gap-2` row. */
  header: ReactNode;
  /** Trailing controls outside the toggle (menus, probe buttons). They
   * rest slightly dimmed and come to full ink on card hover. */
  actions?: ReactNode;
  /** Keep the actions at full ink (not hover-only) while one runs. */
  actionsPinned?: boolean;
  /** Always-visible strip between the header and the body (e.g. a
   * probe error that must show whether or not the card is open). */
  notice?: ReactNode;
  /** Animate the body open/closed with a grid-rows sweep. The body stays
   * mounted (inert while closed) for the animation; without this flag
   * the body mounts only while open. */
  animateBody?: boolean;
  /**
   * `card` — a raised `bg-surface` card on the Settings canvas; its body
   * opens onto `bg-app`, and the border firms up while open.
   * `inset` — the same header and caret, nested inside an already-raised
   * editor (`bg-elevated`). It takes no fill of its own: a `bg-app` body
   * there would sink a whole slab below its container (foundations
   * §2.1 「Elevation 不倒置」), so structure is carried by lines only.
   */
  surface?: "card" | "inset";
  rootRef?: Ref<HTMLDivElement>;
  /** Body padding / spacing. Defaults to `px-2.5 py-3`. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const inset = surface === "inset";
  const body = (
    <div
      className={cn(
        "border-t border-line/70 px-2.5 py-3",
        !inset && "bg-app",
        bodyClassName,
      )}
    >
      {children}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "group/disclosure overflow-hidden rounded-sm border",
        inset
          ? "border-line/70"
          : cn(
              "bg-surface transition-colors duration-(--motion-fast) ease-firm motion-reduce:transition-none",
              open ? "border-line-strong" : "border-line",
            ),
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-1.5">
        <button
          type="button"
          onMouseDown={preventMouseFocus}
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-0.5 text-left",
            "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center",
              CARET_MOTION,
              open ? "rotate-90 text-ink" : "rotate-0 text-ink-soft",
            )}
          >
            <CaretRight size={12} weight="bold" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {header}
          </span>
        </button>
        {actions && (
          <div
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1.5 opacity-80",
              "group-hover/disclosure:opacity-100",
              actionsPinned && "opacity-100",
            )}
          >
            {actions}
          </div>
        )}
      </div>

      {notice}

      {animateBody ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-(--motion-base) ease-firm motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden" inert={!open || undefined}>
            {body}
          </div>
        </div>
      ) : (
        open && body
      )}
    </div>
  );
}

/**
 * Bordered, hairline-divided container for `SettingsDisclosureRow` /
 * `SettingsNavRow`. Rows carry no border of their own, so anything that
 * needs to land on the group (e.g. the Runtime activation pulse) goes on
 * this container via `className`.
 */
export function SettingsDisclosureList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

const LIST_ROW_CLASS = cn(
  "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
);

const LIST_ROW_TITLE_CLASS = "text-ui-compact font-medium text-ink";

/** Accordion row: the whole row toggles; content opens in place below. */
export function SettingsDisclosureRow({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** Status chip next to the title — visible while collapsed, so state
   * (e.g. "external GA active") never hides inside the accordion. */
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Accordion content stays borderless and flat (Settings §9 Runtime
   * layering rule): no cards inside the list row. */
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(LIST_ROW_CLASS, "hover:bg-hover")}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={LIST_ROW_TITLE_CLASS}>{title}</span>
          {badge}
        </span>
        <CaretRight
          size={12}
          weight="bold"
          aria-hidden
          className={cn(
            "shrink-0 text-ink-soft",
            CARET_MOTION,
            open ? "rotate-90" : "rotate-0",
          )}
        />
      </button>
      {open && <div className="px-3 pb-4 pt-2">{children}</div>}
    </div>
  );
}

/** Navigation row: the whole row opens another surface (arrow glyph). */
export function SettingsNavRow({
  title,
  subtitle,
  disabled = false,
  onOpen,
}: {
  title: string;
  subtitle?: ReactNode;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        LIST_ROW_CLASS,
        disabled ? "cursor-not-allowed" : "hover:bg-hover",
      )}
    >
      <span className="min-w-0">
        {/* Disabled dims only the title and arrow: the subtitle then
            carries the reason, already at ink-muted — dimming it again
            would make the one line worth reading the faintest. */}
        <span
          className={cn(
            "block",
            LIST_ROW_TITLE_CLASS,
            disabled && "opacity-60",
          )}
        >
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block text-ui-tertiary leading-notice text-ink-muted">
            {subtitle}
          </span>
        )}
      </span>
      <ArrowRight
        size={12}
        weight="bold"
        aria-hidden
        className={cn("shrink-0 text-ink-soft", disabled && "opacity-60")}
      />
    </button>
  );
}
