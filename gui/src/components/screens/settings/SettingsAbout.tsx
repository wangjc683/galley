import { ArrowSquareOut } from "@phosphor-icons/react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { SettingsUpdateControl } from "@/components/screens/settings/SettingsUpdateControl";
import { RELEASE_DATE } from "@/lib/build-info";
import { EPIGRAPHS } from "@/lib/epigraphs";
import { useCopy, useLanguage } from "@/lib/i18n";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";

interface SettingsAboutProps {
  workbenchVersion: string;
  gaBaseline: string;
  managedRuntime?: ManagedRuntimeDiagnostics;
  hasRunningSessions: boolean;
}

/**
 * Settings → About tab, composed as a colophon (docs/temperament.md:
 * the imprint's own page — the one place besides the empty-state
 * epigraph where a quotation is allowed to live).
 *
 * Structure, in book order:
 *   1. Title + tagline
 *   2. Origin story
 *   3. Version — Galley only; the product has one version
 *   4. Typesetting — what the text is set in, stated as fact
 *   5. Links — Galley source/issues, GenericAgent upstream credit
 *      (carrying the engine commit as its detail), maker links.
 *   6. Footer with author + license.
 *   7. Epigraph — PI §43, the page's closing line.
 *
 * The book metaphor stays under the surface: section labels are plain
 * words (版式 / Typesetting), never trade jargon (印次 / 奥付).
 *
 * GA budget on this page is exactly two mentions (docs/temperament.md
 * independent-product positioning): once with feeling (origin story),
 * once with facts (the upstream link row, engine commit as detail).
 * The tagline and the version table stay engine-silent — an
 * independent product's one-line self-description says what it is,
 * not what it is made of.
 */
export function SettingsAbout({
  workbenchVersion,
  gaBaseline,
  managedRuntime,
  hasRunningSessions,
}: SettingsAboutProps) {
  const copy = useCopy();
  const language = useLanguage();
  const colophonEpigraph = EPIGRAPHS.find((e) => e.id === "pi-43");
  const managedKernelCommit =
    managedRuntime?.upstreamCommit || gaBaseline || "unknown";
  const managedKernelShort =
    managedKernelCommit === "unknown"
      ? "unknown"
      : managedKernelCommit.slice(0, 7);
  const managedKernelDate = managedRuntime?.upstreamAuditedAt;

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title="Galley"
        subtitle={copy.settings.about.subtitle}
        wordmark
      />

      {/* Origin story — the "Why Galley?" easter egg. Putting it in
          About means: insiders / curious users find the GenericAgent
          heritage when they look; new users see a clean standalone
          brand on the welcome screen. The GA capitalization is a
          quiet bow, not a billboard. */}
      <div className="rounded-callout border border-line bg-surface px-4 py-3 font-serif text-[13.5px] italic leading-[1.65] text-ink-soft">
        {copy.settings.about.origin}
      </div>

      <div>
        <SettingsSectionLabel>
          {copy.settings.about.version}
        </SettingsSectionLabel>
        <div className="mt-2 text-ui-secondary">
          <SettingsUpdateControl
            hasRunningSessions={hasRunningSessions}
            leading={
              <>
                <span className="font-mono text-ink">v{workbenchVersion}</span>
                {/* Colophon logic: an edition states when it was
                    printed. RELEASE_DATE is the tag date of this
                    version, null in dev builds (no tag, no date). */}
                {RELEASE_DATE && (
                  <span className="text-ui-tertiary text-ink-muted">
                    · {RELEASE_DATE}
                  </span>
                )}
              </>
            }
          />
        </div>
      </div>

      <div>
        <SettingsSectionLabel>
          {copy.settings.about.typesetting}
        </SettingsSectionLabel>
        <p className="m-0 mt-2 text-ui-secondary leading-secondary text-ink-soft">
          {copy.settings.about.typesettingDetail}
        </p>
      </div>

      <div className="border-t border-line pt-6">
        <SettingsSectionLabel>{copy.settings.about.links}</SettingsSectionLabel>
        <div className="mt-3 space-y-1">
          <ExternalLink
            href="https://github.com/wangjc683/galley"
            label="Galley"
            detail="github.com/wangjc683/galley"
          />
          {/* Upstream credit row doubles as the engine's fact line —
              the kernel commit is material information (colophon
              logic: which paper it is printed on), not a second
              product version. Falls back to the plain URL when the
              managed runtime hasn't reported a commit. */}
          <ExternalLink
            href="https://github.com/lsdefine/GenericAgent"
            label="GenericAgent"
            detail={
              managedKernelShort === "unknown"
                ? "github.com/lsdefine/GenericAgent"
                : copy.settings.about.gaKernelDetail(
                    managedKernelShort,
                    managedKernelDate,
                  )
            }
          />
          <div className="pt-3 text-ui-tertiary text-ink-muted">
            {copy.settings.about.alsoBy}
          </div>
          <ExternalLink
            href="https://subsage.top"
            label="SubSage"
            detail={copy.settings.about.subsageDetail}
          />
          <ExternalLink
            href="https://15perf70mm.com"
            label="15perf70mm"
            detail={copy.settings.about.filmDetail}
          />
        </div>
      </div>

      <div className="border-t border-line pt-4 text-ui-meta text-ink-muted">
        {copy.settings.about.madeBy}
      </div>

      {/* Colophon epigraph — the page's closing line, after all the
          practical matter (a book ends on the quotation, not on the
          imprint line). Unboxed, unlike the origin callout above: a
          quote on the page, not a card in the UI. The empty-state
          epigraph stays reserved for the truly silent workspace. */}
      {colophonEpigraph && (
        <figure className="m-0 pt-2 font-serif">
          <blockquote className="m-0 border-0 p-0">
            <p className="m-0 text-[13px] italic leading-[1.6] text-ink-soft">
              {language === "en-US" ? colophonEpigraph.en : colophonEpigraph.zh}
            </p>
            <p
              lang="de"
              className="m-0 mt-1 text-[11.5px] italic leading-[1.5] text-ink-muted/70"
            >
              {colophonEpigraph.de}
            </p>
          </blockquote>
          <figcaption className="mt-1.5 text-ui-tertiary text-ink-muted">
            {copy.settings.about.epigraphSource}
          </figcaption>
        </figure>
      )}
    </div>
  );
}

function ExternalLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group grid min-w-0 grid-cols-[120px_1fr_18px] items-baseline gap-3 rounded-sm px-1 py-1 text-ui-compact hover:bg-hover"
    >
      <span className="font-medium text-ink">{label}</span>
      <span className="min-w-0 text-ink-muted group-hover:text-ink-soft">
        {detail}
      </span>
      <ArrowSquareOut
        size={11}
        weight="thin"
        className="shrink-0 translate-y-px text-ink-muted group-hover:text-brand-strong"
      />
    </a>
  );
}
