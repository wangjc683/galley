import {
  ArrowSquareOut,
  BookOpen,
  CaretDown,
  CaretRight,
  Check,
  Copy,
  Terminal,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

import {
  SettingsFieldLabel,
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useCopy } from "@/lib/i18n";
import { isMac, isWindows } from "@/lib/platform";

type SopCopyState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "copied" }
  | { kind: "error"; reason: string };

/** Mirror of Rust core/src/path_install.rs::PathInstallStatus. */
type PathInstallStatus =
  | { status: "installed"; symlink: string; target: string }
  | { status: "not_installed" }
  | { status: "other_target"; symlink: string; actual: string }
  | { status: "unsupported"; reason: string };

/** Mirror of PathInstallOutcome (install). */
type PathInstallOutcome =
  | { outcome: "installed"; symlink: string; target: string }
  | { outcome: "user_cancelled" }
  | { outcome: "cli_binary_not_found"; searched: string }
  | { outcome: "failed"; reason: string; details: string }
  | { outcome: "unsupported"; reason: string };

/** Mirror of PathUninstallOutcome. */
type PathUninstallOutcome =
  | { outcome: "uninstalled"; symlink: string }
  | { outcome: "not_installed" }
  | { outcome: "user_cancelled" }
  | { outcome: "failed"; reason: string; details: string }
  | { outcome: "unsupported"; reason: string };

/**
 * Settings → Agent tab. PRD §12 / B4 M3 surface — the screen
 * agents route through to wire Galley into their world.
 *
 * The default surface is the ordinary handoff path:
 *
 * 1. **Galley Supervisor SOP** — copy the bundled
 *    `galley-supervisor-sop.md` so the user can paste it into
 *    whichever external agent they trust as Supervisor.
 *    Galley no longer writes this into GenericAgent `memory/`.
 *
 * 2. **Try prompts** — example user messages for the external Agent
 *    that just received the SOP.
 *
 * Implementation details live under Advanced options: discovery file,
 * optional `galley` command shortcut, and Agent API reference.
 */
export function SettingsIntegration() {
  const copy = useCopy();
  const agentCopy = copy.settings.agent;
  const [sopState, setSopState] = useState<SopCopyState>({ kind: "idle" });
  const [sopBody, setSopBody] = useState<string | null>(null);
  const [copiedExampleIndex, setCopiedExampleIndex] = useState<number | null>(
    null,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pathStatus, setPathStatus] = useState<PathInstallStatus | null>(null);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [docOpenError, setDocOpenError] = useState<string | null>(null);
  const pathInstallUnsupportedCopy = isMac
    ? null
    : isWindows
      ? agentCopy.pathUnsupportedWindows
      : agentCopy.pathUnsupportedGeneric;
  const pathInstallHint = isMac ? agentCopy.pathInstallHintMac : null;
  const discoveryPlatformLabel = isMac
    ? "macOS"
    : isWindows
      ? "Windows"
      : "Linux";
  const discoveryFilePath = isWindows
    ? "%APPDATA%\\galley\\cli-path"
    : "~/.config/galley/cli-path";

  // Load command-shortcut install status when the tab mounts. Status check is
  // unprivileged (lstat + readlink), so this is safe to fire eagerly.
  // We re-query after every install / uninstall to keep the UI in
  // sync without polling.
  //
  // refreshPathStatus is also used after install/uninstall outside
  // the effect — kept as a standalone async closure so both call
  // sites share the same query path.
  const refreshPathStatus = async () => {
    try {
      const next = await invoke<PathInstallStatus>("check_path_install_status");
      setPathStatus(next);
    } catch (e) {
      setPathStatus(null);
      setPathError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    // Standard async-effect pattern: spawn a cancellable closure so
    // setState only fires when the component is still mounted. Matches
    // the listener pattern in App.tsx (`cancelled` flag + early-return).
    let cancelled = false;
    void (async () => {
      try {
        const next = await invoke<PathInstallStatus>(
          "check_path_install_status",
        );
        if (!cancelled) setPathStatus(next);
      } catch (e) {
        if (!cancelled) {
          setPathStatus(null);
          setPathError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await invoke<string>("get_supervisor_sop");
        if (!cancelled) setSopBody(body);
      } catch (e) {
        if (!cancelled) {
          setSopState({
            kind: "error",
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openExternal = async (url: string) => {
    setDocOpenError(null);
    try {
      await openUrl(url);
    } catch (e) {
      setDocOpenError(e instanceof Error ? e.message : String(e));
    }
  };

  const installPath = async () => {
    setPathBusy(true);
    setPathError(null);
    try {
      const result = await invoke<PathInstallOutcome>("install_galley_to_path");
      switch (result.outcome) {
        case "installed":
        case "user_cancelled":
          break; // expected outcomes; refresh status to reflect reality
        case "cli_binary_not_found":
          setPathError(agentCopy.cliBinaryNotFound(result.searched));
          break;
        case "failed":
          setPathError(`${result.reason}: ${result.details.slice(0, 200)}`);
          break;
        case "unsupported":
          setPathError(result.reason);
          break;
      }
    } catch (e) {
      setPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setPathBusy(false);
      await refreshPathStatus();
    }
  };

  const uninstallPath = async () => {
    setPathBusy(true);
    setPathError(null);
    try {
      const result = await invoke<PathUninstallOutcome>(
        "uninstall_galley_from_path",
      );
      switch (result.outcome) {
        case "uninstalled":
        case "not_installed":
        case "user_cancelled":
          break;
        case "failed":
          setPathError(`${result.reason}: ${result.details.slice(0, 200)}`);
          break;
        case "unsupported":
          setPathError(result.reason);
          break;
      }
    } catch (e) {
      setPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setPathBusy(false);
      await refreshPathStatus();
    }
  };

  const copySop = async () => {
    if (!sopBody) {
      setSopState({ kind: "error", reason: agentCopy.sopStillLoading });
      return;
    }
    setSopState({ kind: "pending" });
    try {
      await copyTextToClipboard(sopBody);
      setSopState({ kind: "copied" });
    } catch (e) {
      setSopState({
        kind: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const copyExample = async (text: string, index: number) => {
    try {
      await copyTextToClipboard(text);
      setCopiedExampleIndex(index);
      window.setTimeout(() => setCopiedExampleIndex(null), 1400);
    } catch {
      setCopiedExampleIndex(null);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.agent.label}
        subtitle={agentCopy.subtitle}
      />

      {/* Galley Supervisor SOP copy. Galley no longer writes into GenericAgent
          memory; the user copies this document and gives it to the
          external agent they want to empower as Supervisor. */}
      <section>
        <SettingsSectionLabel>{agentCopy.agentSop}</SettingsSectionLabel>
        <p className="mt-2 max-w-[58ch] text-ui-secondary leading-secondary text-ink-soft">
          {agentCopy.sopDescription}
        </p>
        <ul className="mt-3 space-y-1.5">
          {agentCopy.sopCapabilities.map((capability) => (
            <li
              key={capability}
              className="flex items-start gap-2 text-ui-secondary leading-dense text-ink"
            >
              <Check
                size={13}
                weight="bold"
                className="mt-[2px] shrink-0 text-ink-muted"
              />
              <span className="min-w-0">{capability}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={sopState.kind === "pending" || !sopBody}
            onClick={() => void copySop()}
            leadingIcon={
              sopState.kind === "copied" ? (
                <Check size={14} weight="bold" />
              ) : (
                <Copy size={14} weight="thin" />
              )
            }
          >
            {sopState.kind === "pending"
              ? agentCopy.sopCopying
              : sopState.kind === "copied"
                ? agentCopy.sopCopied
                : sopBody
                  ? agentCopy.sopCopy
                  : agentCopy.sopLoading}
          </Button>
          <SopStatus state={sopState} />
        </div>
      </section>

      <section>
        <SettingsSectionLabel>{agentCopy.tryPrompts}</SettingsSectionLabel>
        <div className="mt-3 space-y-1">
          {agentCopy.promptExamples.map((example, index) => (
            <Button
              key={example}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${agentCopy.copyExample}: ${example}`}
              className="group h-auto w-full items-start justify-start gap-1.5 rounded-none border-l border-line px-3 py-1 text-left hover:border-brand/40 hover:bg-hover/50 focus-visible:border-brand/40 focus-visible:bg-hover/50"
              onClick={() => void copyExample(example, index)}
            >
              <span className="min-w-0 flex-1 whitespace-normal text-ui-secondary leading-secondary text-ink">
                {example}
              </span>
              <span
                className={`mt-[1px] flex size-5 shrink-0 items-center justify-center group-hover:text-ink ${
                  copiedExampleIndex === index
                    ? "text-ink opacity-100"
                    : "text-ink-muted opacity-40 group-hover:opacity-100"
                }`}
              >
                {copiedExampleIndex === index ? (
                  <Check size={13} weight="bold" />
                ) : (
                  <Copy size={13} weight="thin" />
                )}
              </span>
            </Button>
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-2">
        <button
          type="button"
          className="-mx-2 flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <span className="text-ui-secondary font-medium text-ink">
            {agentCopy.advanced}
          </span>
          {advancedOpen ? (
            <CaretDown size={12} weight="bold" className="shrink-0 text-ink-soft" />
          ) : (
            <CaretRight size={12} weight="bold" className="shrink-0 text-ink-soft" />
          )}
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-6">
            {/* Discovery file row. Informational, not interactive — the
                file is written automatically at Galley startup (B4 M3
                T3.1) and supervisors read it without needing user
                input. Kept under Advanced because it is implementation
                detail, not part of the ordinary user handoff path. */}
            <div>
              <SettingsFieldLabel>{agentCopy.discoveryFile}</SettingsFieldLabel>
              <p className="mt-2 text-ui-secondary leading-[1.6] text-ink-soft">
                {agentCopy.discoveryDescription}
              </p>
              <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 text-ui-secondary">
                <dt className="text-ink-muted">{discoveryPlatformLabel}</dt>
                <dd className="m-0 select-text break-all font-mono text-ink">
                  {discoveryFilePath}
                </dd>
              </dl>
            </div>

            {/* Optional `galley` command shortcut (T3.3). Supervisors do
                not need this because the SOP uses the discovery file.
                macOS can create /usr/local/bin/galley via the system
                auth prompt; Windows is intentionally presented as
                unsupported until the user-level PATH writer exists. */}
            <div>
              <SettingsFieldLabel>{agentCopy.cliShortcut}</SettingsFieldLabel>
              <p className="mt-2 text-ui-secondary leading-[1.6] text-ink-soft">
                {agentCopy.cliDescription}
              </p>
              {pathInstallHint && (
                <p className="mt-2 text-ui-tertiary text-ink-muted">
                  {pathInstallHint}
                </p>
              )}
              <PathInstallRow
                status={pathStatus}
                busy={pathBusy}
                unsupportedCopy={pathInstallUnsupportedCopy}
                onInstall={() => void installPath()}
                onUninstall={() => void uninstallPath()}
              />
              {pathError && <InlineErrorWithCopy message={pathError} />}
            </div>

            {/* Developer-facing docs link. Kept low ceremony: this is
                for users wiring their own scripts / Skills / agents,
                while the SOP covers the normal copy-paste path. */}
            <div>
              <SettingsFieldLabel>{agentCopy.apiDocs}</SettingsFieldLabel>
              <p className="mt-2 text-ui-secondary leading-[1.6] text-ink-soft">
                {agentCopy.apiDescription}
              </p>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void openExternal(
                      "https://github.com/wangjc683/galley/blob/main/docs/agent-api.md",
                    )
                  }
                  leadingIcon={<BookOpen size={14} weight="thin" />}
                  trailingIcon={<ArrowSquareOut size={11} weight="thin" />}
                >
                  {agentCopy.openApiDocs}
                </Button>
                {docOpenError && (
                  <InlineErrorWithCopy
                    message={agentCopy.openFailed(docOpenError)}
                    details={docOpenError}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Three states map to three UI shapes:
 *   - not_installed     [ 安装 galley 命令 ] button only
 *   - installed          status line + [ 移除命令 ] button
 *   - other_target       status line ("当前指向：…") + [ 替换 / 移除 ] buttons
 *   - unsupported        explanatory text only, no button
 *
 * Loading state (`busy`) disables every button uniformly so the user
 * can't double-click during the auth prompt. `null` status (the brief
 * window before the first refreshPathStatus resolves) renders the
 * default install button without preloading any state — first paint
 * stays responsive.
 */
function PathInstallRow({
  status,
  busy,
  unsupportedCopy,
  onInstall,
  onUninstall,
}: {
  status: PathInstallStatus | null;
  busy: boolean;
  unsupportedCopy?: string | null;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const copy = useCopy().settings.agent;
  if (unsupportedCopy || status?.status === "unsupported") {
    return (
      <p className="mt-3 text-ui-meta text-ink-muted">
        {unsupportedCopy ?? copy.pathUnsupportedGeneric}
      </p>
    );
  }

  // installed: current symlink matches our CLI binary
  if (status?.status === "installed") {
    return (
      <div className="mt-3 space-y-2">
        <p
          className="select-text break-all text-ui-meta text-ink-soft"
          title={status.target}
        >
          {copy.pathInstalled}
          <code className="font-mono text-ink">{status.symlink}</code>
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onUninstall}
          leadingIcon={<Terminal size={14} weight="thin" />}
        >
          {busy ? copy.pathBusy : copy.pathRemove}
        </Button>
      </div>
    );
  }

  // other_target: someone else (or stale Galley install) owns the path
  if (status?.status === "other_target") {
    return (
      <div className="mt-3 space-y-2">
        <p
          className="select-text break-all text-ui-meta text-ink-soft"
          title={status.actual}
        >
          <code className="font-mono text-ink">{status.symlink}</code>{" "}
          {copy.pathOccupied}
          <code className="font-mono">{status.actual.slice(0, 60)}</code>
          {status.actual.length > 60 && "…"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="destructive-soft"
            size="sm"
            disabled={busy}
            onClick={onInstall}
            leadingIcon={<Terminal size={14} weight="thin" />}
          >
            {busy ? copy.pathBusy : copy.pathReplace}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onUninstall}
          >
            {busy ? copy.pathBusy : copy.pathRemove}
          </Button>
        </div>
      </div>
    );
  }

  // not_installed (or null status before first check completes)
  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={onInstall}
        leadingIcon={<Terminal size={14} weight="thin" />}
      >
        {busy ? copy.pathAuth : copy.pathInstall}
      </Button>
    </div>
  );
}

/**
 * Inline status line next to the install button. Stays low-emphasis
 * ([11px], ink-muted) so the section label and prose dominate; the
 * install button is the visual anchor.
 */
function SopStatus({ state }: { state: SopCopyState }) {
  const copy = useCopy().settings.agent;
  switch (state.kind) {
    case "idle":
      return null;
    case "pending":
      return (
        <span className="text-ui-label text-ink-muted">{copy.sopPending}</span>
      );
    case "copied":
      return (
        <span className="text-ui-label text-ink-soft">{copy.readyForAgent}</span>
      );
    case "error":
      return (
        <span
          className="select-text break-all text-ui-label text-error"
          title={state.reason}
        >
          {copy.sopFailed(state.reason.slice(0, 80))}
          {state.reason.length > 80 && "…"}
        </span>
      );
  }
}

function InlineErrorWithCopy({
  message,
  details,
}: {
  message: string;
  details?: string;
}) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const visible =
    message.length > 140 ? `${message.slice(0, 140)}…` : message;
  return (
    <div className="mt-2 flex items-start gap-2 text-ui-label text-error">
      <p className="m-0 min-w-0 flex-1 select-text break-all" title={message}>
        {visible}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-1.5 text-ui-micro text-error/75 hover:text-error"
        onClick={() => {
          void copyTextToClipboard(details ?? message).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? copy.errors.copiedDetails : copy.errors.copyDetails}
      </Button>
    </div>
  );
}
