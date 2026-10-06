import { CheckCircle, Info } from "@phosphor-icons/react";

import { SettingsStatusBadge } from "@/components/screens/settings/settings-badges";
import { SettingsFieldLabel } from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";

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
          {/* Self-updated is information, not a fault: the note below
              says what it means, so the badge stays neutral. font-sans
              because the row is mono and the label is prose. */}
          <SettingsStatusBadge
            tone={isMatched ? "success" : "neutral"}
            icon={isMatched ? CheckCircle : Info}
            className="ml-1 font-sans"
          >
            {isMatched ? copy.aligned : copy.selfUpdated}
          </SettingsStatusBadge>
        </div>
      )}
      <p className="mt-1.5 text-ui-tertiary leading-secondary text-ink-muted">
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
