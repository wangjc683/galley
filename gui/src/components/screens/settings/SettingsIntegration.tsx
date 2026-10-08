import { BookOpen, Check, Copy, Terminal } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

import {
  SettingsDisclosureList,
  SettingsDisclosureRow,
} from "@/components/screens/settings/settings-disclosure";
import {
  SettingsFieldLabel,
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isChineseLanguage } from "@/lib/language";
import { accessLocalFile } from "@/lib/local-files";
import { isMac, isWindows, platformName } from "@/lib/platform";

import { ExternalLinkIcon } from "./external-link";
import { InlineCodeText } from "./inline-code-text";
import {
  parentDirectory,
  parseDiscoveryCliPath,
  pathInstallError,
  pathInstallNotice,
  pathUninstallError,
  type PathActionError,
  type PathInstallNotice,
  type PathInstallOutcome,
  type PathInstallStatus,
  type PathUninstallOutcome,
} from "./path-install";

type SopCopyState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "copied" }
  | { kind: "error"; reason: string };

/** The bundled SOP text, fetched once per mount. Reading it and copying
 * it fail for different reasons, so the two failures read differently. */
type SopLoadState =
  | { kind: "loading" }
  | { kind: "ready"; body: string }
  | { kind: "failed"; reason: string };

/**
 * Windows has no one-click install yet, so the command-shortcut row
 * points at the folder holding galley.exe instead. Source: the discovery
 * file Galley Core writes at startup (`%APPDATA%\galley\cli-path`,
 * core/src/discovery.rs; line 1 = the CLI's absolute path), read through
 * the existing `access_local_file` command. The path is confirmed with
 * `path_exists`, so a stale file left by a moved install falls back to
 * the generic sentence instead of naming a dead folder.
 */
async function readWindowsCliDir(): Promise<string | null> {
  try {
    const { dataDir, join } = await import("@tauri-apps/api/path");
    const file = await join(await dataDir(), "galley", "cli-path");
    const { content } = await accessLocalFile(file, "read");
    const cliPath = parseDiscoveryCliPath(content ?? "");
    if (!cliPath) return null;
    const exists = await invoke<boolean>("path_exists", { path: cliPath });
    return exists ? parentDirectory(cliPath) : null;
  } catch (e) {
    console.warn("[SettingsIntegration] CLI folder lookup failed", e);
    return null;
  }
}

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
  const labelSeparator = isChineseLanguage(useLanguage()) ? "：" : ": ";
  const [sopState, setSopState] = useState<SopCopyState>({ kind: "idle" });
  const [sopLoad, setSopLoad] = useState<SopLoadState>({ kind: "loading" });
  // The button's 「已复制」 settles after COPY_FEEDBACK_MS like every other
  // copy affordance; the status line beside it stays until the next copy.
  const [sopCopiedFlash, setSopCopiedFlash] = useState(false);
  const sopCopiedTimerRef = useRef<number | null>(null);
  const [copiedExampleIndex, setCopiedExampleIndex] = useState<number | null>(
    null,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pathStatus, setPathStatus] = useState<PathInstallStatus | null>(null);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathError, setPathError] = useState<PathActionError | null>(null);
  const [docOpenError, setDocOpenError] = useState<string | null>(null);
  // Windows only: `undefined` until the discovery file has been read.
  const [windowsCliDir, setWindowsCliDir] = useState<string | null | undefined>(
    undefined,
  );
  const pathNotice = pathInstallNotice(
    platformName,
    pathStatus?.status === "unsupported",
    windowsCliDir,
  );
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
      setPathError({ message: e instanceof Error ? e.message : String(e) });
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
          setPathError({
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (platformName !== "windows") return;
    let cancelled = false;
    void (async () => {
      const dir = await readWindowsCliDir();
      if (!cancelled) setWindowsCliDir(dir);
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
        if (!cancelled) setSopLoad({ kind: "ready", body });
      } catch (e) {
        if (!cancelled) {
          setSopLoad({
            kind: "failed",
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sopCopiedTimerRef.current !== null) {
        window.clearTimeout(sopCopiedTimerRef.current);
      }
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
      // Expected outcomes map to null; the status refresh below reflects
      // reality either way.
      setPathError(pathInstallError(result, agentCopy, import.meta.env.DEV));
    } catch (e) {
      setPathError({
        message: agentCopy.pathInstallFailed,
        details: e instanceof Error ? e.message : String(e),
      });
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
      setPathError(pathUninstallError(result, agentCopy));
    } catch (e) {
      setPathError({
        message: agentCopy.pathRemoveFailed,
        details: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPathBusy(false);
      await refreshPathStatus();
    }
  };

  const clearSopCopiedFlash = () => {
    if (sopCopiedTimerRef.current !== null) {
      window.clearTimeout(sopCopiedTimerRef.current);
      sopCopiedTimerRef.current = null;
    }
  };

  const copySop = async () => {
    // The button stays disabled until the SOP is ready.
    if (sopLoad.kind !== "ready") return;
    setSopState({ kind: "pending" });
    try {
      await copyTextToClipboard(sopLoad.body);
      setSopState({ kind: "copied" });
      setSopCopiedFlash(true);
      clearSopCopiedFlash();
      sopCopiedTimerRef.current = window.setTimeout(() => {
        setSopCopiedFlash(false);
        sopCopiedTimerRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch (e) {
      clearSopCopiedFlash();
      setSopCopiedFlash(false);
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
      window.setTimeout(() => setCopiedExampleIndex(null), COPY_FEEDBACK_MS);
    } catch {
      setCopiedExampleIndex(null);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.agent.title}
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
            disabled={sopState.kind === "pending" || sopLoad.kind !== "ready"}
            onClick={() => void copySop()}
            leadingIcon={
              sopCopiedFlash ? (
                <Check size={14} weight="bold" />
              ) : (
                <Copy size={14} weight="thin" />
              )
            }
          >
            {sopState.kind === "pending"
              ? agentCopy.sopCopying
              : sopCopiedFlash
                ? agentCopy.sopCopied
                : sopLoad.kind === "loading"
                  ? agentCopy.sopLoading
                  : agentCopy.sopCopy}
          </Button>
          <SopStatus
            state={sopState}
            loadError={sopLoad.kind === "failed" ? sopLoad.reason : null}
          />
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
              aria-label={`${agentCopy.copyExample}${labelSeparator}${example}`}
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

      <section>
        <SettingsDisclosureList>
          <SettingsDisclosureRow
            title={agentCopy.advanced}
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((current) => !current)}
          >
            <div className="space-y-6">
              {/* Discovery file row. Informational, not interactive — the
                  file is written automatically at Galley startup (B4 M3
                  T3.1) and supervisors read it without needing user
                  input. Kept under Advanced because it is implementation
                  detail, not part of the ordinary user handoff path. */}
              <div>
                <SettingsFieldLabel>
                  {agentCopy.discoveryFile}
                </SettingsFieldLabel>
                <p className="mt-2 text-ui-secondary leading-secondary text-ink-soft">
                  <InlineCodeText text={agentCopy.discoveryDescription} />
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
                  auth prompt; Windows has no one-click install until the
                  user-level PATH writer exists, so it names the CLI's
                  folder for a manual PATH entry instead. */}
              <div>
                <SettingsFieldLabel>{agentCopy.cliShortcut}</SettingsFieldLabel>
                <p className="mt-2 text-ui-secondary leading-secondary text-ink-soft">
                  <InlineCodeText text={agentCopy.cliDescription} />
                </p>
                {pathInstallHint && (
                  <p className="mt-2 text-ui-tertiary text-ink-muted">
                    {pathInstallHint}
                  </p>
                )}
                <PathInstallRow
                  status={pathStatus}
                  busy={pathBusy}
                  notice={pathNotice}
                  onInstall={() => void installPath()}
                  onUninstall={() => void uninstallPath()}
                />
                {pathError && (
                  <InlineErrorWithCopy
                    message={pathError.message}
                    details={pathError.details}
                  />
                )}
              </div>

              {/* Developer-facing docs link. Kept low ceremony: this is
                  for users wiring their own scripts / Skills / agents,
                  while the SOP covers the normal copy-paste path. */}
              <div>
                <SettingsFieldLabel>{agentCopy.apiDocs}</SettingsFieldLabel>
                <p className="mt-2 text-ui-secondary leading-secondary text-ink-soft">
                  {agentCopy.apiDescription}
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void openExternal(
                        "https://github.com/wangjc683/galley/blob/main/docs/agent-api/README.md",
                      )
                    }
                    leadingIcon={<BookOpen size={14} weight="thin" />}
                    trailingIcon={<ExternalLinkIcon />}
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
          </SettingsDisclosureRow>
        </SettingsDisclosureList>
      </section>
    </div>
  );
}

/**
 * Three states map to three UI shapes:
 *   - not_installed     [ 安装 galley 命令 ] button only
 *   - installed          status line + [ 移除命令 ] button
 *   - other_target       status line ("当前指向：…") + [ 替换 / 移除 ] buttons
 *   - unsupported        explanatory text only, no button (`notice`;
 *                        Windows adds the CLI folder for a manual PATH
 *                        entry, see `pathInstallNotice`)
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
  notice,
  onInstall,
  onUninstall,
}: {
  status: PathInstallStatus | null;
  busy: boolean;
  notice: PathInstallNotice | null;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const copy = useCopy().settings.agent;
  if (notice?.kind === "pending") return null;
  if (notice?.kind === "windows-manual") {
    return (
      <div className="mt-3">
        <p className="text-ui-meta text-ink-muted">
          <InlineCodeText text={copy.pathUnsupportedWindows} />
        </p>
        <p className="mt-1.5 select-text break-all font-mono text-ui-secondary text-ink">
          {notice.dir}
        </p>
      </div>
    );
  }
  if (notice?.kind === "generic") {
    return (
      <p className="mt-3 text-ui-meta text-ink-muted">
        {copy.pathUnsupportedGeneric}
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
 * Inline status line next to the copy button. Stays low-emphasis
 * (11.5px, ink-muted) so the section label and prose dominate; the
 * copy button is the visual anchor. A failed SOP read outranks the copy
 * state: the button is disabled then, so no copy can be in flight.
 */
function SopStatus({
  state,
  loadError,
}: {
  state: SopCopyState;
  loadError: string | null;
}) {
  const copy = useCopy().settings.agent;
  if (loadError !== null) {
    return <SopError reason={loadError} format={copy.sopLoadFailed} />;
  }
  switch (state.kind) {
    // While pending the button already reads 「复制中…」; a second word
    // for the same moment is noise.
    case "idle":
    case "pending":
      return null;
    case "copied":
      return (
        <span className="text-ui-tertiary text-ink-soft">
          {copy.readyForAgent}
        </span>
      );
    case "error":
      return <SopError reason={state.reason} format={copy.sopFailed} />;
  }
}

function SopError({
  reason,
  format,
}: {
  reason: string;
  format: (reason: string) => string;
}) {
  return (
    <span
      className="select-text break-all text-ui-tertiary text-error"
      title={reason}
    >
      {format(reason.slice(0, 80))}
      {reason.length > 80 && "…"}
    </span>
  );
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
    <div className="mt-2 flex items-start gap-2 text-ui-tertiary text-error">
      <p className="m-0 min-w-0 flex-1 select-text break-all" title={message}>
        {visible}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-1.5 text-ui-tertiary text-error/75 hover:text-error"
        onClick={() => {
          void copyTextToClipboard(details ?? message).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
          });
        }}
      >
        {copied ? copy.errors.copiedDetails : copy.errors.copyDetails}
      </Button>
    </div>
  );
}
