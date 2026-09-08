import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { TopBarIconButton } from "../TopBarIconButton";

export function ChangesToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (source: HTMLElement) => void;
}) {
  const copy = useCopy().gitReview;
  return (
    <TooltipLabel text={open ? copy.closeChanges : copy.openChanges}>
      <TopBarIconButton
        aria-label={copy.title}
        aria-pressed={open}
        className="aria-pressed:border-line aria-pressed:bg-hover aria-pressed:text-ink"
        onClick={(event) => onToggle(event.currentTarget)}
      >
        {/* Match Phosphor's 256-unit grid and thin stroke; the file and
            stacked minus/plus express content changes rather than branches. */}
        <svg
          width={16}
          height={16}
          viewBox="0 0 256 256"
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M152 32H64a8 8 0 0 0-8 8v176a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8V80Z" />
          <path d="M152 32v48h48M100 120h56M100 176h56M128 148v56" />
        </svg>
      </TopBarIconButton>
    </TooltipLabel>
  );
}
