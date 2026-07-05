import { CheckCircle, Info } from "@phosphor-icons/react";

import { SettingsFieldLabel } from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function GAVersionCard({
  gaCommit,
  gaCommitDate,
  gaBaseline,
}: {
  gaCommit: string;
  gaCommitDate: string;
  gaBaseline: string;
}) {
  const copy = useCopy().settings.runtime;
  const isUnknown = gaCommit === "unknown" || gaCommit === "";
  const isMatched = !isUnknown && gaCommit === gaBaseline;
  const currentShort = isUnknown ? "unknown" : gaCommit.slice(0, 7);
  const baselineShort = gaBaseline.slice(0, 7);
  const currentDate = formatCommitDate(gaCommitDate);

  return (
    <div>
      <SettingsFieldLabel>{copy.genericAgentVersion}</SettingsFieldLabel>
      <div className="mt-1.5 flex items-center gap-2 font-mono text-ui-secondary text-ink">
        <span className="text-ink-muted">{copy.currentVersion}</span>
        <span className="select-text">{currentShort}</span>
        {currentDate && <span className="text-ink-muted">· {currentDate}</span>}
      </div>
      {!isUnknown && (
        <div className="mt-1 flex items-center gap-2 font-mono text-ui-meta text-ink-soft">
          <span className="text-ink-muted">{copy.verifiedVersion}</span>
          <span className="select-text">{baselineShort}</span>
          <span
            className={cn(
              "ml-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-ui-micro not-italic",
              isMatched
                ? "bg-success/[var(--opacity-soft)] text-success"
                : "bg-hover text-ink-muted",
            )}
          >
            {isMatched ? (
              <>
                <CheckCircle size={11} weight="fill" />
                {copy.aligned}
              </>
            ) : (
              <>
                <Info size={11} weight="bold" />
                {copy.selfUpdated}
              </>
            )}
          </span>
        </div>
      )}
      <p className="mt-1.5 text-ui-tertiary leading-[1.55] text-ink-muted">
        {copy.commitCompatibilityNote}
      </p>
    </div>
  );
}

/**
 * Extract YYYY-MM-DD from the commit's own ISO timestamp without
 * routing through `new Date()` - that would convert to the viewer's
 * local timezone and silently shift a commit authored late at +08 to
 * "yesterday" for a PST viewer. The commit is a single artifact with
 * one authored date; we display it as the author wrote it, matching
 * what `git log` shows.
 */
function formatCommitDate(iso: string): string {
  if (!iso || iso === "unknown") return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}
