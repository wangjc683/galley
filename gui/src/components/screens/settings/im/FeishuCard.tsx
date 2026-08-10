import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteFeishuImConfig,
  getFeishuImConfig,
  saveFeishuImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindFeishuImOwner,
  type FeishuImConfig,
  type ImSupervisorState,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { ChannelCard } from "./ChannelCard";
import { ChannelErrorBlock } from "./ChannelErrorBlock";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FeishuCommandReference } from "./CommandReference";
import { FeishuSetupGuide } from "./FeishuSetupGuide";
import { FeishuGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { feishuStatusHintForState } from "./status";

/** Last-loaded config, module-level for the same reason as the
 * status cache in useImSupervisorStatus: re-entering Channels should
 * paint the card's real state on the first frame instead of deriving
 * a wrong default from null and snapping when the fetch lands. */
let cachedFeishuConfig: FeishuImConfig | null = null;

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
  const [config, setConfigState] = useState<FeishuImConfig | null>(
    () => cachedFeishuConfig,
  );
  const setConfig = (next: FeishuImConfig | null) => {
    cachedFeishuConfig = next;
    setConfigState(next);
  };
  const [appId, setAppId] = useState(cachedFeishuConfig?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [localBusy, setLocalBusy] = useState<
    "load" | "open" | "save" | "connect" | "stop" | "disconnect" | "unbind" | null
  >(cachedFeishuConfig ? null : "load");
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmUnbindOpen, setConfirmUnbindOpen] = useState(false);

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
  // Auto-expansion waits for both fetches: deriving it from null
  // config/status guesses "not configured → expand", which is wrong
  // for every configured user and snaps shut when the data lands.
  // Collapsed-then-expand (fresh first load, unconfigured) is an
  // additive motion; expanded-then-collapse is a flash.
  const ready = config !== null && status !== null;
  const expanded =
    expandedOverride ??
    (ready &&
      (attentionState ||
        derivedState === "not_connected" ||
        derivedState === "stopped" ||
        !canSaveCredentials ||
        (derivedState !== "running" && !canStartService)));
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

  const unbind = () =>
    run("unbind", async () => {
      onStatusChange(await unbindFeishuImOwner());
      setConfig(await getFeishuImConfig());
    });

  // Owner binding view state. The live status wins (it carries the
  // pairing code while running unbound); the persisted config covers
  // the stopped-but-bound case.
  const ownerOpenId =
    status?.ownerOpenId ?? config?.ownerOpenId ?? null;
  const ownerBoundAt = config?.ownerBoundAt ?? null;
  const bindCode = ownerOpenId ? null : (status?.bindCode ?? null);

  const openFeishuConsole = () =>
    run("open", async () => {
      await openUrl("https://open.feishu.cn/");
    });

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<FeishuGlyph active={expanded} />}
        title={imCopy.feishuTitle}
        badge={
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
        }
        busy={busy}
        actions={
          canPause || canDisconnect ? (
            <ChannelActionsMenu
              disabled={busy}
              canStop={canPause}
              canDisconnect={canDisconnect}
              onStop={stop}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          ) : null
        }
      >
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
                    <span className="mb-1.5 block text-ui-meta font-medium text-ink-soft">
                      {imCopy.feishuAppIdLabel}
                    </span>
                    <input
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                      placeholder={imCopy.feishuAppIdPlaceholder}
                      spellCheck={false}
                      className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-ui-meta font-medium text-ink-soft">
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
                      className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                    />
                  </label>
                </div>
              }
              saveAction={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    // Primary tracks the current actionable step: while
                    // credentials aren't saved yet, saving IS the next
                    // step; once the service can start, save demotes to
                    // a secondary re-save and start takes primary.
                    variant={canStartService ? "secondary" : "primary"}
                    size="sm"
                    disabled={busy || !canSaveCredentials}
                    leadingIcon={
                      localBusy === "save" ? (
                        <CircleNotch size={13} className="spin" />
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
                    <span className="text-ui-meta text-ink-muted">
                      {imCopy.feishuConfigLoading}
                    </span>
                  ) : null}
                </div>
              }
              startAction={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={canStartService ? "primary" : "secondary"}
                    size="sm"
                    disabled={busy || !canStartService}
                    leadingIcon={
                      localBusy === "connect" ? (
                        <CircleNotch size={13} className="spin" />
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

          {ownerOpenId ? (
            <OwnerBoundRow
              ownerId={ownerOpenId}
              boundAt={ownerBoundAt}
              boundLabel={imCopy.feishuBoundLabel}
              boundAtLabel={imCopy.feishuBoundAt}
              unbindLabel={imCopy.feishuUnbind}
              workingLabel={imCopy.working}
              busy={busy}
              working={localBusy === "unbind"}
              onUnbind={() => setConfirmUnbindOpen(true)}
            />
          ) : bindCode ? (
            <BindCodeCallout
              title={imCopy.feishuBindWaitingTitle}
              lead={imCopy.feishuBindWaitingLead}
              code={bindCode}
              afterCode={`${imCopy.feishuBindWaitingAfterCode} ${imCopy.feishuOwnerScopeAdvice}`}
            />
          ) : null}

          <p className="text-ui-tertiary leading-notice text-ink-muted">
            {imCopy.feishuOwnerSecurityNote}
          </p>

          <ChannelErrorBlock
            error={localError ?? statusLoadError ?? status?.lastError ?? null}
          />
        </div>
      </ChannelCard>

      <ConfirmActionDialog
        open={confirmUnbindOpen}
        onOpenChange={setConfirmUnbindOpen}
        busy={busy}
        title={imCopy.feishuUnbindDialogTitle}
        body={imCopy.feishuUnbindDialogBody}
        confirmLabel={imCopy.feishuUnbind}
        onConfirm={() => {
          setConfirmUnbindOpen(false);
          void unbind();
        }}
      />

      <ConfirmActionDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        busy={busy}
        title={imCopy.feishuDisconnectDialogTitle}
        body={imCopy.feishuDisconnectDialogBody}
        confirmLabel={imCopy.disconnect}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          void disconnect();
        }}
      />
    </>
  );
}
