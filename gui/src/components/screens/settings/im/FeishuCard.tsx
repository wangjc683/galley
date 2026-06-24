import { openUrl } from "@tauri-apps/plugin-opener";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  Power,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteFeishuImConfig,
  getFeishuImConfig,
  saveFeishuImConfig,
  startImSupervisor,
  stopImSupervisor,
  type FeishuImConfig,
  type ImSupervisorState,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { cn } from "@/lib/utils";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { FeishuCommandReference } from "./CommandReference";
import { FeishuSetupGuide } from "./FeishuSetupGuide";
import { FeishuGlyph } from "./Glyphs";
import { StatusBadge } from "./StatusBadge";
import { feishuStatusHintForState } from "./status";

export function FeishuCard({
  status,
  statusLoadError,
  onStatusChange,
}: {
  status: ImSupervisorStatus | null;
  statusLoadError: string | null;
  onStatusChange: (status: ImSupervisorStatus | null) => void;
}) {
  const appCopy = useCopy();
  const imCopy = appCopy.settings.im;
  const commonCopy = appCopy.common;
  const [config, setConfig] = useState<FeishuImConfig | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [localBusy, setLocalBusy] = useState<
    "load" | "open" | "save" | "connect" | "stop" | "disconnect" | null
  >("load");
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getFeishuImConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setAppId(next.appId);
        setLocalError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setLocalError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLocalBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savedAppId = config?.appId.trim() ?? "";
  const trimmedAppId = appId.trim();
  const hasSavedSecretForApp =
    Boolean(config?.hasAppSecret) && trimmedAppId === savedAppId;
  const hasUsableSecret = appSecret.trim().length > 0 || hasSavedSecretForApp;
  const canSaveCredentials = trimmedAppId.length > 0 && hasUsableSecret;
  const canStartService =
    trimmedAppId.length > 0 &&
    trimmedAppId === savedAppId &&
    Boolean(config?.hasAppSecret);
  const derivedState: ImSupervisorState =
    status?.state ??
    (config?.appId && config.hasAppSecret ? "stopped" : "not_connected");
  const attentionState = derivedState === "expired" || derivedState === "error";
  const expanded =
    expandedOverride ??
    (attentionState ||
      derivedState === "not_connected" ||
      derivedState === "stopped" ||
      !canSaveCredentials ||
      (derivedState !== "running" && !canStartService));
  const canPause = derivedState === "running";
  const canDisconnect =
    derivedState === "running" ||
    derivedState === "expired" ||
    derivedState === "error" ||
    derivedState === "stopped";
  const busy = localBusy !== null;

  const run = async (
    action: Exclude<typeof localBusy, null | "load">,
    fn: () => Promise<void>,
  ) => {
    setLocalBusy(action);
    setLocalError(null);
    try {
      await fn();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(null);
    }
  };

  const saveCredentials = () =>
    run("save", async () => {
      const saved = await saveFeishuImConfig({
        appId: appId.trim(),
        appSecret: appSecret.trim() || null,
      });
      setConfig(saved);
      setAppSecret("");
      onStatusChange(null);
      setExpandedOverride(true);
    });

  const connect = () =>
    run("connect", async () => {
      onStatusChange(await startImSupervisor("feishu", false));
    });

  const stop = () =>
    run("stop", async () => {
      onStatusChange(await stopImSupervisor("feishu"));
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const nextConfig = await deleteFeishuImConfig();
      setConfig(nextConfig);
      setAppId("");
      setAppSecret("");
      onStatusChange(null);
    });

  const openFeishuConsole = () =>
    run("open", async () => {
      await openUrl("https://open.feishu.cn/");
    });

  return (
    <section
      className={cn(
        "group/im overflow-hidden rounded-sm border border-line bg-surface transition-colors",
        expanded && "border-line-strong",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 px-2 py-1.5 transition-colors",
          expanded && "bg-hover/40",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          className={cn(
            "group/toggle flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-0.5 text-left transition-colors",
            "hover:bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
          )}
          onClick={() => setExpandedOverride(!expanded)}
        >
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-soft transition-colors",
              expanded && "text-ink",
            )}
          >
            {expanded ? (
              <CaretDown size={12} weight="bold" />
            ) : (
              <CaretRight size={12} weight="bold" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <FeishuGlyph active={expanded} />
            <span
              className="min-w-0 truncate text-[13px] font-medium text-ink"
              title={imCopy.feishuTitle}
            >
              {imCopy.feishuTitle}
            </span>
            <StatusBadge
              state={derivedState}
              iconStateOverride={
                derivedState === "stopped" ? "not_connected" : undefined
              }
              labelOverride={
                derivedState === "running"
                  ? imCopy.feishuServiceStarted
                  : derivedState === "stopped"
                    ? imCopy.feishuNotStarted
                    : undefined
              }
            />
          </span>
        </button>
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5 opacity-80 transition-opacity",
            "group-hover/im:opacity-100 group-focus-within/im:opacity-100",
            busy && "opacity-100",
          )}
        >
          {canPause || canDisconnect ? (
            <ChannelActionsMenu
              disabled={busy}
              canStop={canPause}
              canDisconnect={canDisconnect}
              onStop={stop}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line/70 bg-hover/25 px-2.5 py-3">
          <div className="space-y-4 pl-8 pr-1">
            {derivedState === "running" ? (
              <FeishuSetupGuide
                imCopy={imCopy}
                status={feishuStatusHintForState(derivedState, imCopy)}
                onOpenConsole={openFeishuConsole}
                openDisabled={busy}
                statusPlacement="top"
                afterStatus={<FeishuCommandReference imCopy={imCopy} />}
                collapsible
              />
            ) : (
              <FeishuSetupGuide
                imCopy={imCopy}
                status={feishuStatusHintForState(derivedState, imCopy)}
                onOpenConsole={openFeishuConsole}
                openDisabled={busy}
                credentialsForm={
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                        {imCopy.feishuAppIdLabel}
                      </span>
                      <input
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                        placeholder={imCopy.feishuAppIdPlaceholder}
                        spellCheck={false}
                        className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                        {imCopy.feishuAppSecretLabel}
                      </span>
                      <input
                        type="password"
                        value={appSecret}
                        onChange={(e) => setAppSecret(e.target.value)}
                        placeholder={
                          hasSavedSecretForApp
                            ? imCopy.feishuSecretSavedPlaceholder
                            : imCopy.feishuAppSecretPlaceholder
                        }
                        spellCheck={false}
                        className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                      />
                    </label>
                  </div>
                }
                saveAction={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={busy || !canSaveCredentials}
                      leadingIcon={
                        localBusy === "save" ? (
                          <CircleNotch size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )
                      }
                      onClick={saveCredentials}
                    >
                      {localBusy === "save"
                        ? imCopy.working
                        : imCopy.feishuSaveCredentials}
                    </Button>
                    {localBusy === "load" ? (
                      <span className="text-[12px] text-ink-muted">
                        {imCopy.feishuConfigLoading}
                      </span>
                    ) : null}
                  </div>
                }
                startAction={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={busy || !canStartService}
                      leadingIcon={
                        localBusy === "connect" ? (
                          <CircleNotch size={13} className="animate-spin" />
                        ) : (
                          <Power size={13} />
                        )
                      }
                      onClick={connect}
                    >
                      {localBusy === "connect"
                        ? imCopy.working
                        : imCopy.feishuStartService}
                    </Button>
                  </div>
                }
              />
            )}

            {localError || statusLoadError || status?.lastError ? (
              <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-error/80">
                  {imCopy.lastError}
                </div>
                <div className="select-text break-words font-mono text-[11.5px] leading-[1.45] text-error">
                  {localError ?? statusLoadError ?? status?.lastError}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Dialog.Root
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
          <Dialog.Content
            role="alertdialog"
            aria-describedby="disconnect-feishu-desc"
            className={cn(
              "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
              "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            )}
          >
            <div className="flex items-center gap-2">
              <WarningCircle size={18} weight="bold" className="text-warning" />
              <Dialog.Title className="text-[15px] font-semibold text-ink">
                {imCopy.feishuDisconnectDialogTitle}
              </Dialog.Title>
            </div>
            <p
              id="disconnect-feishu-desc"
              className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
            >
              {imCopy.feishuDisconnectDialogBody}
            </p>
            <DialogActionRow>
              <Button
                variant="secondary"
                onClick={() => setConfirmDisconnectOpen(false)}
                disabled={busy}
                autoFocus
              >
                {commonCopy.cancel}
              </Button>
              <Button
                variant="destructive-soft"
                disabled={busy}
                onClick={() => {
                  setConfirmDisconnectOpen(false);
                  void disconnect();
                }}
              >
                {imCopy.disconnect}
              </Button>
            </DialogActionRow>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
