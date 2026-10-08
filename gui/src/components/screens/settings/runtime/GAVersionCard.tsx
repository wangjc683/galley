import { CheckCircle, Info } from "@phosphor-icons/react";

import { SettingsStatusBadge } from "@/components/screens/settings/settings-badges";
import { SettingsFieldLabel } from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";

/**
 * The attached GenericAgent checkout's version vs the verified baseline.
 * Rendered by the parent only once an external session has reported its
 * HEAD (`RuntimeInfo.gaCommitRuntimeKind === "external"`) — before that
 * the values describe the bundled engine, not the user's GA.
 *
 * Rows are prose (sans) with only the hash and date in mono, so the
 * Chinese labels never fall back through the monospace stack.
 */
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
  const baselineShort = gaBaseline.slice(0, 7);
  const currentDate = formatCommitDate(gaCommitDate);

  return (
    <div>
      <SettingsFieldLabel>{copy.genericAgentVersion}</SettingsFieldLabel>
      <div className="mt-1.5 flex items-center gap-2 text-ui-secondary text-ink">
        <span className="text-ink-muted">{copy.currentVersion}</span>
        {isUnknown ? (
          <span>{copy.gaVersionUnknown}</span>
        ) : (
          <span className="select-text font-mono">{gaCommit.slice(0, 7)}</span>
        )}
        {currentDate && (
          <span className="text-ink-muted">
            · <span className="font-mono">{currentDate}</span>
          </span>
        )}
      </div>
      {!isUnknown && (
        <div className="mt-1 flex items-center gap-2 text-ui-secondary text-ink-soft">
          <span className="text-ink-muted">{copy.verifiedVersion}</span>
          <span className="select-text font-mono">{baselineShort}</span>
          {/* Self-updated is information, not a fault: the note below
              says what it means, so the badge stays neutral. */}
          <SettingsStatusBadge
            tone={isMatched ? "success" : "neutral"}
            icon={isMatched ? CheckCircle : Info}
            className="ml-1"
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
