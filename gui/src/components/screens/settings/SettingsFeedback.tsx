import { Check, Copy } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { useCopy } from "@/lib/i18n";
import { usePrefsStore } from "@/stores/prefs";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";

import { ExternalLinkIcon } from "./external-link";
import {
  buildFeedbackPayload,
  formatHealthLine,
  type HealthCheckDto,
} from "./feedback-payload";

/**
 * Settings → 报告问题 — the in-app feedback path (issue #15, scoped).
 *
 * Two jobs:
 *   1. One-click routes into the GitHub issue forms, with the bug
 *      form's environment fields prefilled via the issue-forms query
 *      params (keys are the template field `id`s; dropdown values
 *      must match the option strings verbatim — keep them in sync
 *      with `.github/ISSUE_TEMPLATE/bug-report.yml`).
 *   2. A payload preview of the environment info that rides along.
 *
 * The preview is deliberately a verbatim monospace block — the exact
 * text the Copy button copies and the bug form carries — not a
 * label/value table. Runtime → 高级诊断 already renders the
 * dashboard-style table for install debugging; this surface answers
 * a different question ("what leaves this machine?"), and showing
 * the literal outgoing text lets the user *see* the privacy rule
 * instead of trusting a claim about it.
 *
 * Privacy rule: versions and statuses only. Health check `detail`
 * strings are deliberately dropped — they carry local paths (DB file
 * under the user's home, external GA path), which is exactly the
 * content issue #15 asked us never to ship off-machine unreviewed.
 * Checks the command doesn't probe (`deferred_b4`) are left out too.
 * The text itself is built in ./feedback-payload.ts.
 */

const REPO_NEW_ISSUE_URL = "https://github.com/wangjc683/galley/issues/new";

/** Verbatim dropdown option strings from bug-report.yml. */
const OS_OPTIONS = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
} as const;
const ENGINE_OPTIONS = {
  managed: "内置内核（默认） / Bundled engine (default)",
  external: "外部 GA / External GenericAgent",
} as const;

function detectOs(): keyof typeof OS_OPTIONS | null {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/windows/i.test(ua)) return "windows";
  if (/mac/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return null;
}

export function SettingsFeedback({
  workbenchVersion,
  managedRuntime,
  externalGaCommit,
}: {
  workbenchVersion: string;
  managedRuntime?: ManagedRuntimeDiagnostics;
  /** HEAD commit an external session's `ready` reported; external
   * engine only (see feedback-payload.ts). */
  externalGaCommit?: string;
}) {
  const copy = useCopy();
  const feedbackCopy = copy.settings.feedback;
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  // Raw checks, not the formatted line: once every unprobed check is
  // filtered out the line can be empty, which must still read as
  // "loaded", not "loading".
  const [healthChecks, setHealthChecks] = useState<HealthCheckDto[] | null>(
    null,
  );
  const [healthFailed, setHealthFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<{ checks: HealthCheckDto[] }>("health_report")
      .then((report) => {
        if (cancelled) return;
        setHealthChecks(report.checks);
      })
      .catch(() => {
        // Vite-only dev has no Tauri runtime; a real failure just
        // means the payload ships without the health row.
        if (!cancelled) setHealthFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const os = detectOs();
  const isManaged = activeRuntimeKind === "managed";

  // The single source for preview, Copy, and the bug-form prefill.
  const payload = buildFeedbackPayload({
    workbenchVersion,
    os: os ? OS_OPTIONS[os] : null,
    activeRuntimeKind,
    managedRuntime,
    externalGaCommit,
    healthLine: healthChecks ? formatHealthLine(healthChecks) : null,
  });

  const openBugForm = () => {
    const params = new URLSearchParams();
    params.set("template", "bug-report.yml");
    params.set("galley-version", workbenchVersion);
    if (os) params.set("os", OS_OPTIONS[os]);
    params.set(
      "engine",
      isManaged ? ENGINE_OPTIONS.managed : ENGINE_OPTIONS.external,
    );
    if (payload.healthField) params.set("health", payload.healthField);
    void openUrl(`${REPO_NEW_ISSUE_URL}?${params.toString()}`);
  };

  const openFeatureForm = () => {
    void openUrl(`${REPO_NEW_ISSUE_URL}?template=feature-request.yml`);
  };

  const copyEnv = async () => {
    try {
      await copyTextToClipboard(payload.text);
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS,
      );
    } catch (e) {
      console.warn("[SettingsFeedback] env copy failed", e);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={feedbackCopy.title}
        subtitle={feedbackCopy.subtitle}
      />

      <div>
        <p className="m-0 text-ui-secondary leading-secondary text-ink-soft">
          {feedbackCopy.intro}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            trailingIcon={<ExternalLinkIcon />}
            onClick={openBugForm}
          >
            {feedbackCopy.reportBug}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            trailingIcon={<ExternalLinkIcon />}
            onClick={openFeatureForm}
          >
            {feedbackCopy.requestFeature}
          </Button>
        </div>
      </div>

      <div>
        <SettingsSectionLabel>
          {feedbackCopy.attachSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-2 rounded-sm border border-line bg-surface">
          {/* Wraps for display only (a typical health line is wider
              than the box); Copy and the bug form get the text as is. */}
          <pre className="m-0 whitespace-pre-wrap break-words px-4 py-3 font-mono text-ui-meta leading-[1.7] text-ink-soft">
            {payload.text}
          </pre>
          <div className="flex items-center justify-between gap-3 border-t border-line/70 px-4 py-2">
            <p className="m-0 text-ui-tertiary leading-secondary text-ink-muted">
              {healthChecks
                ? feedbackCopy.envNote
                : healthFailed
                  ? feedbackCopy.healthUnavailable
                  : feedbackCopy.healthLoading}
            </p>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={
                copied ? (
                  <Check size={14} weight="bold" />
                ) : (
                  <Copy size={14} weight="thin" />
                )
              }
              onClick={() => void copyEnv()}
            >
              {copied ? feedbackCopy.copied : feedbackCopy.copyEnv}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
