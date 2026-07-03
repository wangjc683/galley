import { ArrowSquareOut } from "@phosphor-icons/react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { SettingsUpdateControl } from "@/components/screens/settings/SettingsUpdateControl";
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
 *   3. Version table (Galley + bundled GenericAgent kernel)
 *   4. Typesetting — what the text is set in, stated as fact
 *   5. Epigraph — PI §43, the product's thesis line (meaning is use)
 *   6. Links — Galley source/issues, GenericAgent upstream credit,
 *      plus a quiet maker link group.
 *   7. Footer with author + license.
 *
 * The book metaphor stays under the surface: section labels are plain
 * words (版式 / Typesetting), never trade jargon (印次 / 奥付).
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
        <dl className="m-0 mt-2 grid grid-cols-[120px_1fr] items-center gap-y-2 text-[12.5px]">
          <dt className="text-ink-muted">
            {copy.settings.about.galleyVersion}
          </dt>
          <dd className="m-0 min-w-0">
            <SettingsUpdateControl
              hasRunningSessions={hasRunningSessions}
              leading={
                <span className="font-mono text-ink">v{workbenchVersion}</span>
              }
            />
          </dd>

          <dt className="text-ink-muted">
            {copy.settings.about.bundledGAVersion}
          </dt>
          <dd className="m-0 font-mono text-ink">
            {managedKernelShort}
            {managedKernelDate && (
              <span className="text-ink-muted"> · {managedKernelDate}</span>
            )}
          </dd>
        </dl>
      </div>

      <div>
        <SettingsSectionLabel>
          {copy.settings.about.typesetting}
        </SettingsSectionLabel>
        <p className="m-0 mt-2 text-[12.5px] leading-secondary text-ink-soft">
          {copy.settings.about.typesettingDetail}
        </p>
      </div>

      {/* Colophon epigraph — the quotation's permanent home (the
          empty-state epigraph is reserved for the truly silent
          workspace). Unboxed, unlike the origin callout above: a
          quote on the page, not a card in the UI. */}
      {colophonEpigraph && (
        <figure className="m-0 font-serif">
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
          <figcaption className="mt-1.5 text-[11.5px] text-ink-muted">
            {copy.settings.about.epigraphSource}
          </figcaption>
        </figure>
      )}

      <div className="border-t border-line pt-6">
        <SettingsSectionLabel>{copy.settings.about.links}</SettingsSectionLabel>
        <div className="mt-3 space-y-1">
          <ExternalLink
            href="https://github.com/wangjc683/galley"
            label="Galley"
            detail="github.com/wangjc683/galley"
          />
          <ExternalLink
            href="https://github.com/wangjc683/galley/issues"
            label={copy.settings.about.feedback}
            detail="GitHub Issues"
          />
          <ExternalLink
            href="https://github.com/lsdefine/GenericAgent"
            label="GenericAgent"
            detail="github.com/lsdefine/GenericAgent"
          />
          <div className="pt-3 text-[11.5px] text-ink-muted">
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

      <div className="border-t border-line pt-4 text-[12px] text-ink-muted">
        {copy.settings.about.madeBy}
      </div>
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
      className="group grid min-w-0 grid-cols-[120px_1fr_18px] items-baseline gap-3 rounded-sm px-1 py-1 text-[13px] transition-colors hover:bg-hover"
    >
      <span className="font-medium text-ink">{label}</span>
      <span className="min-w-0 text-ink-muted group-hover:text-ink-soft">
        {detail}
      </span>
      <ArrowSquareOut
        size={11}
        weight="thin"
        className="shrink-0 translate-y-px text-ink-muted transition-colors group-hover:text-brand-strong"
      />
    </a>
  );
}
